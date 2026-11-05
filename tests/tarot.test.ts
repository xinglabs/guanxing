import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import pg from "pg";
import { tarotDeck, tarotSpreads, tarotContext } from "../src/lib/tarot";
import { createTarotState, revealTarot, publicTarot } from "../server/tarot";
import { Store } from "../server/store";
import { createPublicApiServer } from "../server/public-server";
import { sampleInput } from "../src/lib/chart";
const input = {
  question: "我该如何开始一项新计划？",
  spreadId: "three",
  reversedAllowed: true,
};
test("78 complete cards, meanings and attributable local images match their checksums", () => {
  assert.equal(tarotDeck.length, 78);
  assert.equal(new Set(tarotDeck.map((c) => c.id)).size, 78);
  const sources = JSON.parse(
    readFileSync(
      new URL("../public/assets/tarot/sources.json", import.meta.url),
      "utf8",
    ),
  );
  const entries = Array.isArray(sources) ? sources : sources.cards;
  assert.equal(entries.length, 78);
  for (const card of tarotDeck) {
    assert.ok(card.name);
    assert.ok(card.upright.length);
    assert.ok(card.reversed.length);
    const source = entries.find((s: any) => s.id === card.id);
    assert.ok(source);
    const bytes = readFileSync(
      new URL("../public/assets/tarot/" + card.id + ".jpg", import.meta.url),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      source.sha256,
    );
    assert.equal(source.license, "Public domain");
  }
});
test("shuffle is a permutation, every spread draws unique cards; reveal is immutable and retry safe", () => {
  for (const spread of tarotSpreads) {
    const state = createTarotState(
      { ...input, spreadId: spread.id },
      (max) => max - 1,
    );
    assert.equal(new Set(state._deck).size, 78);
    assert.deepEqual(publicTarot(state).cards, []);
    assert.equal("_deck" in publicTarot(state), false);
    const indices = Array.from(
      { length: spread.positions.length },
      (_, i) => i,
    );
    const reading = revealTarot(state, indices);
    assert.equal(reading.status, "revealed");
    assert.equal(reading.cards.length, spread.positions.length);
    assert.equal(
      new Set(reading.cards.map((c) => c.cardId)).size,
      indices.length,
    );
    assert.ok(reading.cards.every((c) => c.reversed));
    assert.deepEqual(revealTarot(reading, indices), reading);
    assert.throws(
      () =>
        revealTarot(
          reading,
          indices.map((i) => i + 1),
        ),
      /不能修改/,
    );
    assert.equal("_deck" in reading, false);
    assert.ok(
      JSON.stringify(tarotContext(reading)).includes(tarotDeck[0].name),
    );
  }
  const noReversal = createTarotState(
    { ...input, reversedAllowed: false },
    () => 0,
  );
  assert.ok(
    revealTarot(noReversal, [0, 7, 77]).cards.every((c) => !c.reversed),
  );
});
test("draw validates input and never accepts repeated, out of bounds or fractional positions", () => {
  for (const value of [
    { ...input, question: "" },
    { ...input, question: "x".repeat(1001) },
    { ...input, spreadId: "fake" },
    { ...input, reversedAllowed: "true" },
  ])
    assert.throws(() => createTarotState(value));
  const state = createTarotState(input);
  for (const positions of [
    null,
    [],
    [0, 1],
    [0, 0, 1],
    [0, 1, 78],
    [0, 1, -1],
    [0, 1, 2.1],
    ["0", 1, 2],
  ])
    assert.throws(() => revealTarot(state, positions));
});
test(
  "hosted tarot: private snapshots, concurrent reveal, shared quotas, model context and ledger",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 },
  async (t) => {
    const root = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    const dbName = "guanxing_tarot_" + randomUUID().replaceAll("-", "");
    await root.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = "/" + dbName;
    const store = new Store(url.toString());
    await store.migrate();
    await store.migrate();
    const requests: any[] = [];
    const fakeKey = "tarot-test-only-not-a-real-key";
    const provider = createServer(async (req, res) => {
      assert.equal(req.headers.authorization, "Bearer " + fakeKey);
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      requests.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content:
                  "先从一个小目标开始。这是本地测试回复，不调用收费模型。",
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 30 },
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const setupToken = "tarot-test-" + randomUUID();
    const server = createPublicApiServer({
      store,
      appSecret: "d".repeat(64),
      setupToken,
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = "http://127.0.0.1:" + (server.address() as any).port;
    const cookies = new Map<string, string>();
    t.after(async () => {
      await server.stopWorker();
      server.closeAllConnections();
      provider.closeAllConnections();
      await Promise.all([
        new Promise<void>((r) => server.close(() => r())),
        new Promise<void>((r) => provider.close(() => r())),
      ]);
      await store.close();
      await root.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
      await root.end();
    });
    async function api(
      who: string,
      path: string,
      method = "GET",
      data?: object,
    ) {
      const r = await fetch(base + "/api" + path, {
        method,
        headers: {
          Origin: base,
          Cookie: cookies.get(who) || "",
          ...(data ? { "Content-Type": "application/json" } : {}),
        },
        body: data ? JSON.stringify(data) : undefined,
      });
      const token = r.headers.get("set-cookie");
      if (token) cookies.set(who, token.split(";")[0]);
      const result = (await r.json()) as any;
      assert.ok(!JSON.stringify(result).includes(fakeKey));
      assert.ok(!JSON.stringify(result).includes("_deck"));
      assert.ok(!JSON.stringify(result).includes("_orientations"));
      return { status: r.status, ...result };
    }
    async function good(
      who: string,
      path: string,
      method = "GET",
      data?: object,
    ) {
      const r = await api(who, path, method, data);
      assert.ok(r.status < 300, JSON.stringify(r));
      return r;
    }
    const password = "disposable-tarot-password";
    await good("admin", "/auth/setup", "POST", {
      username: "admin",
      password,
      setupToken,
    });
    await good("admin", "/admin/settings", "PUT", {
      registrationOpen: true,
      dailyRunLimit: 2,
    });
    for (const username of ["alice", "bob"])
      await good(username, "/auth/register", "POST", { username, password });
    const model = (
      await good("admin", "/models", "POST", {
        name: "Local fake",
        baseUrl: "http://127.0.0.1:" + (provider.address() as any).port + "/v1",
        model: "fake",
        enabled: true,
        inputPricePerMillion: 2,
        outputPricePerMillion: 8,
        currency: "CNY",
        dailyTokenLimit: 1000000,
        dailyCostLimit: 5,
      })
    ).model;
    await good("admin", `/models/${model.id}/secret`, "POST", {
      apiKey: fakeKey,
    });
    assert.equal(
      (
        await api("anon", "/tarot", "POST", {
          ...input,
          requestId: randomUUID(),
        })
      ).status,
      401,
    );
    const requestId = randomUUID();
    const created = (
      await good("alice", "/tarot", "POST", { ...input, requestId })
    ).session;
    assert.equal(created.birth, null);
    assert.equal(created.tarot.status, "selecting");
    assert.deepEqual(created.tarot.cards, []);
    assert.equal(
      (await good("alice", "/tarot", "POST", { ...input, requestId })).session
        .id,
      requestId,
    );
    assert.equal(
      (
        await api("alice", "/tarot", "POST", {
          ...input,
          requestId,
          question: "changed",
        })
      ).status,
      409,
    );
    assert.equal(
      (await api("bob", "/tarot", "POST", { ...input, requestId })).status,
      409,
    );
    assert.equal(
      (
        await api("bob", `/tarot/${requestId}/reveal`, "POST", {
          selection: [0, 1, 2],
        })
      ).status,
      404,
    );
    assert.equal((await api("bob", `/sessions/${requestId}`)).status, 404);
    await good("alice", "/export");
    await good("alice", `/sessions/${requestId}`);
    assert.equal(
      (
        await api("alice", `/sessions/${requestId}/jobs`, "POST", {
          content: "interpret",
          idempotencyKey: randomUUID(),
        })
      ).status,
      409,
    );
    assert.equal(requests.length, 0);
    const race = await Promise.all(
      [
        [0, 1, 2],
        [3, 4, 5],
      ].map((selection) =>
        api("alice", `/tarot/${requestId}/reveal`, "POST", { selection }),
      ),
    );
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    const snapshot = race.find((r) => r.status === 200)!.session.tarot;
    assert.deepEqual(
      (
        await good("alice", `/tarot/${requestId}/reveal`, "POST", {
          selection: snapshot.selection,
        })
      ).session.tarot,
      snapshot,
    );
    assert.deepEqual(
      (await good("alice", `/sessions/${requestId}`)).session.tarot,
      snapshot,
    );
    assert.equal((await good("bob", "/sessions")).sessions.length, 0);
    assert.equal((await api("alice", "/models")).status, 403);
    assert.equal((await api("alice", "/usage")).status, 403);
    assert.equal(
      (
        await api("alice", `/sessions/${requestId}/jobs`, "POST", {
          content: "x",
          apiKey: "client-key",
          idempotencyKey: randomUUID(),
        })
      ).status,
      400,
    );
    async function run(content: string) {
      const payload = { content, idempotencyKey: randomUUID() };
      const job = (
        await good("alice", `/sessions/${requestId}/jobs`, "POST", payload)
      ).job;
      assert.equal(
        (await good("alice", `/sessions/${requestId}/jobs`, "POST", payload))
          .job.id,
        job.id,
      );
      for (let i = 0; i < 100; i++) {
        const r = await good("alice", `/jobs/${job.id}`);
        if (!["queued", "running"].includes(r.job.status)) {
          assert.equal(r.job.status, "completed");
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.fail("Job timeout");
    }
    await run(input.question);
    await run("把刚才的建议说具体一点");
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.deepEqual(request.tools.map((x: any) => x.function.name).sort(), [
        "propose_memory",
        "search_memory",
      ]);
      const context = request.messages.find(
        (m: any) => m.role === "system" && m.content.includes("attachedTarot"),
      );
      assert.ok(context);
      const serialized = JSON.stringify(request.messages);
      for (const card of snapshot.cards)
        assert.ok(
          serialized.includes(
            tarotDeck.find((c) => c.id === card.cardId)!.name,
          ),
        );
      assert.ok(serialized.includes(input.question));
      assert.ok(!serialized.includes("_deck"));
    }
    const ziwei = (
      await good("alice", "/sessions", "POST", { birth: sampleInput })
    ).session;
    assert.equal(
      (
        await api("alice", `/sessions/${ziwei.id}/jobs`, "POST", {
          content: "读取命盘",
          idempotencyKey: randomUUID(),
        })
      ).status,
      429,
    );
    const usage = await good("admin", "/admin/usage");
    assert.equal(usage.daily.totalTokens, 300);
    assert.equal(usage.allTime.totalTokens, 300);
    const row = usage.users.find((u: any) => u.username === "alice");
    assert.equal(row.requests, 2);
    assert.equal(row.calls, 2);
    assert.equal(row.totalTokens, 300);
    await good("admin", `/admin/users/${row.userId}/limits`, "PUT", {
      dailyRunLimit: 20,
      dailyTokenLimit: 200,
    });
    assert.equal(
      (
        await api("alice", `/sessions/${requestId}/jobs`, "POST", {
          content: "超过token限额",
          idempotencyKey: randomUUID(),
        })
      ).status,
      429,
    );
    assert.equal(requests.length, 2);
    assert.deepEqual(
      (await good("alice", `/sessions/${requestId}`)).session.tarot,
      snapshot,
    );
  },
);
