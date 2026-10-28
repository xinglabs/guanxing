import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { request } from "node:http";
import pg from "pg";
import { Store } from "../server/store";
import { createApiServer, hashPassword, verifyPassword } from "../server/index";
import type { RunResult } from "../server/types";

const password = "local-test-password-2026";
test("owner password hashing uses per-password salt and verifies without storing plaintext", async () => {
  const first = await hashPassword(password),
    second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
  assert.equal(await verifyPassword(password, undefined), false);
});

const testUrl = process.env.TEST_DATABASE_URL;
test(
  "PostgreSQL + pgvector API integration",
  { skip: !testUrl, timeout: 60000 },
  async (t) => {
    // TEST_DATABASE_URL is an administrative connection to a disposable test service.
    // A fresh database is created; no application tables are truncated or reused.
    const admin = new pg.Pool({ connectionString: testUrl });
    const name = "guanxing_test_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(testUrl!);
    url.pathname = "/" + name;
    const store = new Store(url.toString());
    await store.migrate();
    let runnerEntered: (() => void) | undefined,
      runnerResume: (() => void) | undefined;
    let runnerWait: Promise<void> | undefined;
    const server = createApiServer({
      store,
      embed: async () => null,
      embeddingInfo: () => ({
        provider: "disabled",
        configured: false,
        dimensions: 768,
      }),
      runner: async (args) => {
        const profile = await args.store.getModel(args.modelId);
        assert.ok(profile);
        const run = await args.store.createRun(args.sessionId, args.modelId);
        await args.store.addMessage(args.sessionId, "user", args.content);
        runnerEntered?.();
        if (runnerWait) await runnerWait;
        const message = await args.store.addMessage(
          args.sessionId,
          "assistant",
          "测试模型回应",
        );
        await args.store.insertUsage({
          runId: run.id,
          sessionId: args.sessionId,
          modelId: args.modelId,
          modelName: profile.name,
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          estimatedCost: 0.001,
          currency: "USD",
          usageSource: "provider",
          status: "completed",
        });
        await args.store.updateRun(run.id, {
          status: "completed",
          steps: 1,
          events: [
            { tool: "calculate_chart", summary: "命盘已生成", status: "ok" },
          ],
        });
        return {
          runId: run.id,
          message,
          events: [],
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            estimatedCost: 0.001,
            currency: "USD",
            usageSource: "provider",
          },
          memoryCandidates: [],
        } satisfies RunResult;
      },
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    let cookie = "";
    async function api(
      path: string,
      method = "GET",
      data?: unknown,
      options: { authenticated?: boolean; origin?: string } = {},
    ) {
      const response = await fetch(base + "/api" + path, {
        method,
        headers: {
          Origin: options.origin ?? base,
          ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(options.authenticated === false
            ? {}
            : cookie
              ? { Cookie: cookie }
              : {}),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      return { response, data: (await response.json()) as any };
    }
    t.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await store.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    });
    await t.test(
      "idle database disconnect is handled and the pool reconnects",
      async () => {
        const client = await store.pool.connect();
        const pid = (await client.query("SELECT pg_backend_pid() AS pid"))
          .rows[0].pid;
        client.release();
        const disconnected = once(store.pool, "error");
        await admin.query("SELECT pg_terminate_backend($1)", [pid]);
        await disconnected;
        assert.equal(await store.hasOwner(), false);
      },
    );
    await t.test(
      "health exposes setup state; all workspace data require owner auth",
      async () => {
        assert.equal(
          await new Promise<number | undefined>((resolve, reject) => {
            const req = request(
              base + "/api/health",
              { headers: { Host: "untrusted.example" } },
              (res) => {
                res.resume();
                resolve(res.statusCode);
              },
            );
            req.on("error", reject);
            req.end();
          }),
          403,
        );
        assert.equal(
          (
            await fetch(base + "/api/auth/setup", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password }),
            })
          ).status,
          403,
        );
        assert.equal(
          (await fetch(base + "/%2e%2e%2fserver%2findex.ts")).status,
          400,
        );
        const health = await api("/health");
        assert.equal(health.data.needsSetup, true);
        assert.equal(health.data.authenticated, false);
        for (const path of [
          "/sessions",
          "/models",
          "/memories",
          "/usage",
          "/export",
        ])
          assert.equal((await api(path)).response.status, 401);
        assert.equal(
          (
            await api(
              "/auth/setup",
              "POST",
              { password },
              { origin: "https://untrusted.example" },
            )
          ).response.status,
          403,
        );
      },
    );
    await t.test(
      "first owner initialization is atomic and cookie token is hashed in PostgreSQL",
      async () => {
        const attempts = await Promise.all([
          api("/auth/setup", "POST", { password }),
          api("/auth/setup", "POST", { password }),
        ]);
        assert.deepEqual(
          attempts.map((v) => v.response.status).sort(),
          [200, 409],
        );
        const success = attempts.find((v) => v.response.status === 200)!;
        const set = success.response.headers.get("set-cookie")!;
        assert.match(set, /HttpOnly/);
        assert.match(set, /SameSite=Strict/);
        cookie = set.split(";")[0];
        const stored = (
          await store.pool.query("SELECT token_hash FROM auth_sessions")
        ).rows[0].token_hash;
        assert.notEqual(stored, cookie.split("=")[1]);
        assert.match(stored, /^[a-f0-9]{64}$/);
        assert.equal((await api("/health")).data.authenticated, true);
      },
    );
    let sessionId = "",
      modelId = "",
      memoryId = "";
    const profile = {
      name: "Test model",
      baseUrl: "https://api.deepseek.com/v1",
      model: "test",
      enabled: true,
      inputPricePerMillion: 1,
      outputPricePerMillion: 2,
      currency: "USD",
      dailyTokenLimit: 1000,
      dailyCostLimit: 1,
    };
    await t.test(
      "CRUD validates models, supported birth data and origins without persisting keys",
      async () => {
        assert.equal(
          (
            await api("/sessions", "POST", {
              birth: { date: "2025-02-29", hour: 0, gender: "female" },
            })
          ).response.status,
          400,
        );
        const session = await api("/sessions", "POST", {
          title: "测试对话",
          birth: { date: "1995-08-17", hour: 4, gender: "female" },
        });
        assert.equal(session.response.status, 201);
        sessionId = session.data.session.id;
        assert.equal(
          (
            await api("/models", "POST", {
              ...profile,
              apiKey: "must-not-save",
            })
          ).response.status,
          400,
        );
        assert.equal(
          (
            await api("/models", "POST", {
              ...profile,
              inputPricePerMillion: 0,
              outputPricePerMillion: 0,
            })
          ).response.status,
          400,
        );
        assert.equal(
          (
            await api("/models", "POST", {
              ...profile,
              baseUrl: "https://user:secret@api.deepseek.com/v1",
            })
          ).response.status,
          400,
        );
        const model = await api("/models", "POST", profile);
        assert.equal(model.response.status, 201);
        modelId = model.data.model.id;
        assert.equal(
          (
            await api("/models/" + modelId, "PUT", profile, {
              origin: "https://bad.example",
            })
          ).response.status,
          403,
        );
      },
    );
    await t.test(
      "inferred memory is pending until confirmed; vectors retrieve only active scoped memories",
      async () => {
        const pending = await store.addMemory({
          content: "喜欢简洁的回应",
          sessionId,
        });
        memoryId = pending.id;
        assert.equal(pending.status, "pending");
        assert.deepEqual(await store.searchMemories("简洁", sessionId), []);
        const confirmed = await api("/memories/" + memoryId, "PATCH", {
          status: "active",
        });
        assert.equal(confirmed.data.memory.status, "active");
        const vector = Array(768).fill(0);
        vector[0] = 1;
        await store.setMemoryEmbedding(memoryId, vector);
        assert.equal(
          (await store.searchMemories("irrelevant", sessionId, vector))[0].id,
          memoryId,
        );
        const other = await store.createSession();
        await store.addMemory({
          content: "不应泄漏的另一会话内容",
          sessionId: other.id,
          status: "active",
        });
        assert.equal(
          (await store.listMemories({ sessionId, status: "active" })).some(
            (m) => m.sessionId === other.id,
          ),
          false,
        );
        const edited = await api("/memories/" + memoryId, "PATCH", {
          content: "喜欢实际的建议",
        });
        assert.equal(edited.data.memory.hasEmbedding, false);
        await store.setMemoryEmbedding(memoryId, vector, "喜欢简洁的回应");
        assert.equal((await store.getMemory(memoryId))?.hasEmbedding, false);
        assert.equal(
          (await api("/memories/reindex", "POST", {})).response.status,
          400,
        );
      },
    );
    await t.test(
      "run guard prevents simultaneous paid requests and model changes",
      async () => {
        const entered = new Promise<void>((r) => (runnerEntered = r));
        runnerWait = new Promise<void>((r) => (runnerResume = r));
        const first = api("/sessions/" + sessionId + "/runs", "POST", {
          content: "看看命盘",
          modelId,
          apiKey: "ephemeral-key-not-saved",
        });
        await entered;
        assert.equal(
          (
            await api("/sessions/" + sessionId + "/runs", "POST", {
              content: "重复运行",
              modelId,
              apiKey: "x",
            })
          ).response.status,
          409,
        );
        assert.equal(
          (await api("/models/" + modelId, "PUT", profile)).response.status,
          409,
        );
        assert.equal(
          (await api("/sessions/" + sessionId, "DELETE")).response.status,
          409,
        );
        // Starting another process must not mark a currently locked run failed.
        const secondStore = new Store(url.toString());
        await secondStore.migrate();
        await secondStore.close();
        assert.equal((await store.listRuns(sessionId))[0].status, "running");
        runnerResume!();
        const done = await first;
        assert.equal(done.response.status, 200);
        runnerWait = undefined;
        runnerEntered = undefined;
        const detail = await api("/sessions/" + sessionId);
        assert.equal(detail.data.messages.length, 2);
        assert.equal(detail.data.runs[0].events[0].tool, "calculate_chart");
      },
    );
    await t.test(
      "reserved usage updates in place and ledger survives session deletion",
      async () => {
        const daily = await store.dailyUsage(modelId);
        assert.equal(daily.totalTokens, 150);
        const run = await store.createRun(sessionId, modelId);
        const row = await store.insertUsage({
          runId: run.id,
          sessionId,
          modelId,
          modelName: profile.name,
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
          estimatedCost: 0.01,
          currency: "USD",
          usageSource: "estimate",
          status: "reserved",
        });
        await store.updateUsage(row.id, {
          inputTokens: 30,
          outputTokens: 20,
          totalTokens: 50,
          estimatedCost: 0.0001,
          usageSource: "provider",
          status: "completed",
        });
        assert.equal((await store.dailyUsage(modelId)).totalTokens, 200);
        assert.equal(
          (
            await api("/models/" + modelId, "PUT", {
              ...profile,
              currency: "CNY",
            })
          ).response.status,
          400,
        );
        await api("/models/" + modelId, "PUT", {
          ...profile,
          dailyTokenLimit: 200,
        });
        assert.equal(
          (
            await api("/sessions/" + sessionId + "/runs", "POST", {
              content: "额度已满",
              modelId,
              apiKey: "x",
            })
          ).response.status,
          429,
        );
        assert.equal((await store.dailyUsage(modelId)).totalTokens, 200);
        const exported = await api("/export");
        const serialized = JSON.stringify(exported.data);
        assert.ok(!serialized.includes("ephemeral-key-not-saved"));
        assert.ok(!serialized.includes("password_hash"));
        assert.ok(!serialized.includes("token_hash"));
        assert.ok(exported.data.runs.length);
        assert.equal(
          (await api("/sessions/" + sessionId, "DELETE")).response.status,
          200,
        );
        assert.equal((await store.dailyUsage(modelId)).totalTokens, 200);
        assert.equal((await store.listMessages(sessionId)).length, 0);
        assert.equal(await store.getMemory(memoryId), null);
        assert.equal(
          (await store.listUsage()).every((u) => u.sessionId === null),
          true,
        );
        await api("/models/" + modelId, "DELETE");
        assert.equal((await store.getModel(modelId))?.enabled, false);
      },
    );
    await t.test(
      "logout invalidates cookie and repeated invalid logins are throttled",
      async () => {
        assert.equal(
          (await api("/auth/logout", "POST", {})).response.status,
          200,
        );
        assert.equal((await api("/sessions")).response.status, 401);
        for (let i = 0; i < 5; i++)
          assert.equal(
            (await api("/auth/login", "POST", { password: "wrong" })).response
              .status,
            401,
          );
        assert.equal(
          (await api("/auth/login", "POST", { password })).response.status,
          429,
        );
      },
    );
  },
);
