import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import pg from "pg";
import { Store } from "../server/store";
import { createPublicApiServer } from "../server/public-server";
import { CredentialVault } from "../server/vault";
import { sampleInput } from "../src/lib/chart";

test("provider credential encryption is randomized, authenticated and bound to model", () => {
  const vault = new CredentialVault("a".repeat(64));
  const secret = "fake-test-key-only";
  const encrypted = vault.encrypt("model-1", secret);
  assert.ok(!encrypted.includes(secret));
  assert.notEqual(encrypted, vault.encrypt("model-1", secret));
  assert.equal(vault.decrypt("model-1", encrypted), secret);
  assert.throws(() => vault.decrypt("model-2", encrypted));
  assert.throws(() =>
    new CredentialVault("b".repeat(64)).decrypt("model-1", encrypted),
  );
  assert.throws(() => new CredentialVault("short"));
});

test(
  "public website: protected bootstrap, isolated accounts, hosted keys and durable jobs",
  {
    skip: !process.env.TEST_DATABASE_URL,
    timeout: 90000,
  },
  async (t) => {
    const adminDb = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    const dbName = "guanxing_public_" + randomUUID().replaceAll("-", "");
    await adminDb.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = "/" + dbName;
    const store = new Store(url.toString());
    await store.migrate();
    const setupToken = "test-bootstrap-token-" + randomUUID();
    const appSecret = "c".repeat(64);
    const fakeKey = "fake-provider-key-" + randomUUID();
    let unblock!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((r) => {
      entered = r;
    });
    const gate = new Promise<void>((r) => {
      unblock = r;
    });
    const requests: any[] = [];
    const provider = createServer(async (req, res) => {
      assert.equal(req.headers.authorization, `Bearer ${fakeKey}`);
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(input);
      if (requests.length === 1) {
        entered();
        await gate;
      }
      const hasChart = input.messages.some(
        (m: any) => m.role === "tool" && m.tool_call_id === "chart",
      );
      const message = hasChart
        ? { content: "测试解读已完成，测试不调用任何收费模型。" }
        : {
            content: null,
            tool_calls: [
              {
                id: "chart",
                type: "function",
                function: { name: "get_chart", arguments: "{}" },
              },
            ],
          };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message }],
          usage: { prompt_tokens: 120, completion_tokens: 30 },
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const providerPort = (provider.address() as { port: number }).port;
    let server = createPublicApiServer({ store, appSecret, setupToken });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    let base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const cookies = new Map<string, string>();
    async function api(
      who: string,
      path: string,
      method = "GET",
      data?: object,
      extraHeaders: Record<string, string> = {},
    ) {
      const response = await fetch(base + "/api" + path, {
        method,
        headers: {
          Origin: base,
          Cookie: cookies.get(who) || "",
          ...(data ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
        body: data ? JSON.stringify(data) : undefined,
      });
      const token = response.headers.get("set-cookie");
      if (token) cookies.set(who, token.split(";")[0]);
      const payload = (await response.json()) as any;
      assert.ok(
        !JSON.stringify(payload).includes(fakeKey),
        "API responses never return provider keys",
      );
      return { status: response.status, data: payload };
    }
    async function good(
      who: string,
      path: string,
      method = "GET",
      data?: object,
    ) {
      const result = await api(who, path, method, data);
      assert.ok(result.status < 300, JSON.stringify(result));
      return result.data;
    }
    const pw = "disposable-password-2026";
    t.after(async () => {
      unblock();
      await server.stopWorker();
      server.closeAllConnections();
      provider.closeAllConnections();
      await Promise.all([
        new Promise<void>((r) => server.close(() => r())),
        new Promise<void>((r) => provider.close(() => r())),
      ]);
      await store.close();
      await adminDb.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
      await adminDb.end();
    });
    await t.test(
      "bootstrap requires deployment token, registrations start closed",
      async () => {
        const health = await good("anon", "/health");
        assert.equal(health.needsSetup, true);
        assert.equal(health.mode, "public");
        assert.equal(
          (
            await api("admin", "/auth/setup", "POST", {
              username: "admin",
              password: pw,
              setupToken: "wrong",
            })
          ).status,
          403,
        );
        await good("admin", "/auth/setup", "POST", {
          username: "admin",
          password: pw,
          setupToken,
        });
        assert.equal(
          (
            await api("alice", "/auth/register", "POST", {
              username: "alice",
              password: pw,
            })
          ).status,
          403,
        );
        await good("admin", "/admin/settings", "PUT", {
          registrationOpen: true,
          dailyRunLimit: 5,
        });
        await good("alice", "/auth/register", "POST", {
          username: "alice",
          password: pw,
        });
        await good("bob", "/auth/register", "POST", {
          username: "bob",
          password: pw,
        });
        assert.equal((await api("bob", "/admin/users")).status, 403);
        assert.equal(
          (
            await api(
              "alice",
              "/auth/logout",
              "POST",
              {},
              { Origin: "https://evil.invalid" },
            )
          ).status,
          403,
        );
      },
    );
    let aliceSession: string, bobSession: string, modelId: string;
    await t.test(
      "all private data and exports are scoped, models credentials are never exposed",
      async () => {
        aliceSession = (
          await good("alice", "/sessions", "POST", {
            birth: sampleInput,
            title: "Alice private",
          })
        ).session.id;
        bobSession = (
          await good("bob", "/sessions", "POST", {
            birth: sampleInput,
            title: "Bob private",
          })
        ).session.id;
        const memory = (
          await good("alice", "/memories", "POST", {
            content: "only-alice-private-memory",
          })
        ).memory;
        await good("bob", "/memories", "POST", {
          content: "only-bob-private-memory",
        });
        assert.equal(
          (await api("bob", `/sessions/${aliceSession}`)).status,
          404,
        );
        assert.equal(
          (
            await api("bob", `/memories/${memory.id}`, "PATCH", {
              content: "overwrite",
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await api("bob", "/memories", "POST", {
              content: "cross-session",
              sessionId: aliceSession,
            })
          ).status,
          404,
        );
        assert.ok(
          !JSON.stringify(await good("bob", "/export")).includes(
            "only-alice-private-memory",
          ),
        );
        const model = {
          name: "Hosted test",
          baseUrl: `http://127.0.0.1:${providerPort}/v1`,
          model: "test-only",
          enabled: true,
          inputPricePerMillion: 2,
          outputPricePerMillion: 8,
          currency: "CNY",
          dailyTokenLimit: 1000000,
          dailyCostLimit: 5,
        };
        assert.equal(
          (await api("alice", "/models", "POST", model)).status,
          403,
        );
        assert.equal(
          (
            await api("admin", "/models", "POST", {
              ...model,
              dailyTokenLimit: 0,
            })
          ).status,
          400,
        );
        modelId = (await good("admin", "/models", "POST", model)).model.id;
        assert.equal((await api("alice", "/models")).status, 403);
        await good("admin", `/models/${modelId}/secret`, "POST", {
          apiKey: fakeKey,
        });
        assert.equal((await api("alice", "/models")).status, 403);
        assert.equal((await good("admin", "/models")).models[0].hosted, true);
        assert.equal((await api("alice", "/admin/usage")).status, 403);
        assert.ok(!(await store.getModelSecret(modelId))!.includes(fakeKey));
        assert.equal(
          (await api("alice", `/models/${modelId}/secret`, "DELETE")).status,
          403,
        );
      },
    );
    async function poll(who: string, id: string) {
      for (let i = 0; i < 100; i++) {
        const job = (await good(who, `/jobs/${id}`)).job;
        if (!["queued", "running"].includes(job.status)) return job;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.fail("Job never reached terminal state");
    }
    await t.test(
      "jobs return immediately, deduplicate, queue fairly and preserve user context",
      async () => {
        const request = {
          content: "读取我的命盘",
          idempotencyKey: randomUUID(),
        };
        const first = await api(
          "alice",
          `/sessions/${aliceSession}/jobs`,
          "POST",
          request,
        );
        assert.equal(first.status, 202);
        const aliceJob = first.data.job;
        assert.equal(aliceJob.modelId, undefined);
        await enteredPromise;
        const duplicate = await good(
          "alice",
          `/sessions/${aliceSession}/jobs`,
          "POST",
          request,
        );
        assert.equal(duplicate.job.id, aliceJob.id);
        assert.equal((await api("bob", `/jobs/${aliceJob.id}`)).status, 404);
        const bobJob = (
          await good("bob", `/sessions/${bobSession}/jobs`, "POST", {
            ...request,
            modelId: "visitor-cannot-choose-a-model",
            idempotencyKey: randomUUID(),
          })
        ).job;
        assert.equal(bobJob.status, "queued");
        assert.equal(requests.length, 1);
        assert.equal(
          (await good("alice", "/jobs?active=1")).jobs[0].id,
          aliceJob.id,
        );
        unblock();
        assert.equal((await poll("alice", aliceJob.id)).status, "completed");
        assert.equal((await poll("bob", bobJob.id)).status, "completed");
        assert.equal(requests.length, 4);
        assert.ok(
          JSON.stringify(requests[0]).includes("only-alice-private-memory"),
        );
        assert.ok(
          !JSON.stringify(requests[0]).includes("only-bob-private-memory"),
        );
        assert.ok(
          JSON.stringify(requests[2]).includes("only-bob-private-memory"),
        );
        assert.ok(
          !JSON.stringify(requests[2]).includes("only-alice-private-memory"),
        );
        assert.equal((await api("alice", "/usage")).status, 403);
        const platformUsage = await good("admin", "/admin/usage");
        assert.equal(platformUsage.daily.totalTokens, 600);
        assert.equal(platformUsage.allTime.totalTokens, 600);
        for (const name of ["alice", "bob"]) {
          const row = platformUsage.users.find((u: any) => u.username === name);
          assert.equal(row.totalTokens, 300);
          assert.equal(row.requests, 1);
          assert.equal(row.calls, 2);
        }
        assert.equal(
          (await api("admin", "/admin/usage?date=2026-02-30")).status,
          400,
        );
        const exported = await good("alice", "/export");
        for (const key of ["usage", "models", "runs"])
          assert.equal(exported[key], undefined);
        assert.equal(
          (await good("alice", `/jobs/${aliceJob.id}`)).job.result,
          undefined,
        );
        assert.deepEqual(
          (await good("alice", `/sessions/${aliceSession}`)).runs,
          [],
        );
        assert.equal(
          (await good("alice", "/account")).dailyRunLimit,
          undefined,
        );
        const alice = platformUsage.users.find(
          (u: any) => u.username === "alice",
        );
        assert.equal(
          (
            await api("alice", `/admin/users/${alice.userId}/limits`, "PUT", {
              dailyRunLimit: 20,
              dailyTokenLimit: 10000,
            })
          ).status,
          403,
        );
        const changed = await good(
          "admin",
          `/admin/users/${alice.userId}/limits`,
          "PUT",
          { dailyRunLimit: 10, dailyTokenLimit: 100000 },
        );
        assert.equal(changed.user.dailyRunLimit, 10);
        assert.equal(changed.user.dailyTokenLimit, 100000);
        assert.equal(
          (await good("alice", "/health")).user.dailyTokenLimit,
          undefined,
        );
      },
    );
    await t.test(
      "queued work survives HTTP server restart; cancelled jobs count toward the daily quota",
      async () => {
        await server.stopWorker();
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
        server = createPublicApiServer({
          store,
          appSecret,
          setupToken,
          startWorker: false,
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        const queued = (
          await good("alice", `/sessions/${aliceSession}/jobs`, "POST", {
            content: "排队后重启",
            modelId,
            idempotencyKey: randomUUID(),
          })
        ).job;
        const cancel = (
          await good("bob", `/sessions/${bobSession}/jobs`, "POST", {
            content: "稍后取消",
            modelId,
            idempotencyKey: randomUUID(),
          })
        ).job;
        await good("bob", `/jobs/${cancel.id}/cancel`, "POST");
        assert.equal(
          (await good("bob", `/jobs/${cancel.id}`)).job.status,
          "cancelled",
        );
        await good("admin", "/admin/settings", "PUT", {
          registrationOpen: true,
          dailyRunLimit: 2,
        });
        assert.equal(
          (
            await api("bob", `/sessions/${bobSession}/jobs`, "POST", {
              content: "超过每日次数",
              modelId,
              idempotencyKey: randomUUID(),
            })
          ).status,
          429,
        );
        await server.stopWorker();
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
        server = createPublicApiServer({ store, appSecret, setupToken });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        assert.equal((await poll("alice", queued.id)).status, "completed");
      },
    );
    await t.test(
      "password changes and admin account disable revoke old sessions",
      async () => {
        const oldCookie = cookies.get("alice")!;
        await good("alice", "/auth/password", "POST", {
          currentPassword: pw,
          newPassword: "updated-disposable-password",
        });
        assert.equal(
          (
            await api("anon", "/sessions", "GET", undefined, {
              Cookie: oldCookie,
            })
          ).status,
          401,
        );
        assert.equal((await good("alice", "/account")).user.username, "alice");
        const bob = (await good("admin", "/admin/users")).users.find(
          (u: any) => u.username === "bob",
        );
        await good("admin", `/admin/users/${bob.id}`, "PATCH", {
          disabled: true,
        });
        assert.equal((await api("bob", "/sessions")).status, 401);
        const response = await good("admin", "/export");
        assert.ok(!JSON.stringify(response).includes(fakeKey));
      },
    );
  },
);
