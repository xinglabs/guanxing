import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { Store } from "../server/store";
import { StoreError } from "../server/public-types";
import type { ModelProfile, RunResult } from "../server/types";

const testUrl = process.env.TEST_DATABASE_URL;
test(
  "public workspace isolation, legacy migration and durable admission",
  {
    skip: !testUrl,
    timeout: 60000,
  },
  async (t) => {
    const admin = new pg.Pool({ connectionString: testUrl });
    const name = "guanxing_public_store_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(testUrl!);
    url.pathname = "/" + name;
    const store = new Store(url.toString());
    t.after(async () => {
      await store.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    });
    // Simulate a V2 database before accounts or user_id columns existed.
    await store.pool.query(`
    CREATE TABLE owner_auth(id smallint PRIMARY KEY CHECK(id=1),password_hash text NOT NULL);
    INSERT INTO owner_auth VALUES(1,'legacy-password-hash');
    CREATE TABLE auth_sessions(token_hash text PRIMARY KEY,expires_at timestamptz NOT NULL);
    INSERT INTO auth_sessions VALUES('old-cookie-digest',now()+interval '1 day');
    CREATE TABLE sessions(id text PRIMARY KEY,title text NOT NULL,birth jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO sessions(id,title) VALUES('legacy-session','原来的管理员对话');
  `);
    await store.migrate();
    const alice = await store.createAccount({
      username: "alice",
      passwordHash: "hash-alice",
    });
    const bob = await store.createAccount({
      username: "bob",
      passwordHash: "hash-bob",
    });
    const a = store.forUser(alice.id),
      b = store.forUser(bob.id);
    const model = await store.saveModel({
      name: "Fixture model",
      baseUrl: "https://api.deepseek.com",
      model: "fixture",
      enabled: true,
      currency: "CNY",
      inputPricePerMillion: 2,
      outputPricePerMillion: 8,
      dailyTokenLimit: 100000,
      dailyCostLimit: 10,
    } satisfies Omit<ModelProfile, "id">);
    const sa = await a.createSession({ title: "Alice private session" });
    const sb = await b.createSession({ title: "Bob private session" });
    const rb = await b.createRun(sb.id, model.id);

    await t.test(
      "migration preserves owner, credentials and old sessions without claiming new users",
      async () => {
        assert.equal((await store.getAccount("owner"))?.username, "admin");
        assert.equal((await store.authUser("old-cookie-digest"))?.id, "owner");
        assert.equal(
          (await store.accountByUsername("admin"))?.passwordHash,
          "legacy-password-hash",
        );
        assert.equal(
          (await store.getSession("legacy-session"))?.title,
          "原来的管理员对话",
        );
        assert.equal(await a.getSession("legacy-session"), null);
        assert.equal(await store.setupOwner("replacement-hash"), false);
        assert.equal(await store.ownerPassword(), "legacy-password-hash");
        await store.migrate();
        assert.equal((await store.listAccounts()).length, 3);
      },
    );

    await t.test(
      "every private lookup and mutation is scoped, including global and vector memories",
      async () => {
        await a.addMessage(sa.id, "user", "ALICE_PRIVATE_TEXT");
        await b.addMessage(sb.id, "user", "BOB_PRIVATE_TEXT");
        assert.equal(await a.getSession(sb.id), null);
        assert.deepEqual(await a.listMessages(sb.id), []);
        assert.equal(await a.deleteSession(sb.id), false);
        assert.equal(await a.getRun(rb.id), null);
        assert.equal(await a.updateRun(rb.id, { error: "unauthorized" }), null);
        await assert.rejects(a.createRun(sb.id, model.id), StoreError);
        await assert.rejects(
          a.addMessage(sb.id, "assistant", "unauthorized"),
          StoreError,
        );
        await assert.rejects(
          a.addMemory({ sessionId: sb.id, content: "unauthorized" }),
          StoreError,
        );
        const ma = await a.addMemory({
          content: "ALICE_GLOBAL_MEMORY",
          status: "active",
        });
        const mb = await b.addMemory({
          content: "BOB_GLOBAL_MEMORY",
          status: "active",
        });
        await a.addMemory({ content: "ALICE_PENDING", status: "pending" });
        const vector = Array(768).fill(0);
        vector[0] = 1;
        await a.setMemoryEmbedding(ma.id, vector);
        await b.setMemoryEmbedding(mb.id, vector);
        assert.equal(await a.getMemory(mb.id), null);
        assert.equal(
          await a.updateMemory(mb.id, { content: "unauthorized" }),
          null,
        );
        assert.equal(await a.deleteMemory(mb.id), false);
        await a.setMemoryEmbedding(mb.id, null);
        assert.equal((await b.getMemory(mb.id))?.hasEmbedding, true);
        assert.deepEqual(
          (await a.searchMemories("", sa.id)).map((m) => m.id),
          [ma.id],
        );
        assert.deepEqual(
          (await a.searchMemories("", sa.id, vector)).map((m) => m.id),
          [ma.id],
        );
        assert.ok(
          (await a.listMemories()).every((m) => m.content.startsWith("ALICE")),
        );
        assert.equal((await b.getSession(sb.id))?.title, "Bob private session");
      },
    );

    await t.test(
      "usage and exports are private while the model budget covers all users",
      async () => {
        const ra = await a.createRun(sa.id, model.id);
        const base = {
          modelId: model.id,
          modelName: model.name,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          estimatedCost: 0.001,
          currency: "CNY" as const,
          usageSource: "provider" as const,
          status: "completed",
        };
        const ua = await a.insertUsage({
          ...base,
          runId: ra.id,
          sessionId: sa.id,
        });
        const ub = await b.insertUsage({
          ...base,
          runId: rb.id,
          sessionId: sb.id,
        });
        await assert.rejects(
          a.insertUsage({ ...base, runId: rb.id, sessionId: sb.id }),
          StoreError,
        );
        await assert.rejects(
          a.insertUsage({ ...base, runId: rb.id, sessionId: null }),
          StoreError,
        );
        await assert.rejects(
          a.updateUsage(ub.id, { ...base, totalTokens: 999 }),
          /not found/,
        );
        assert.equal((await a.listUsage()).length, 1);
        assert.equal((await a.listUsage())[0].id, ua.id);
        assert.equal((await a.dailyUsage(model.id)).totalTokens, 240);
        assert.equal((await a.dashboard()).today.totalTokens, 120);
        assert.equal((await store.dashboardAll()).today.totalTokens, 240);
        await store.setModelSecret(model.id, "ciphertext-only-fixture");
        assert.equal(
          await store.getModelSecret(model.id),
          "ciphertext-only-fixture",
        );
        await assert.rejects(a.getModelSecret(model.id), StoreError);
        const exported = JSON.stringify(await a.exportData());
        assert.ok(exported.includes("ALICE_PRIVATE_TEXT"));
        assert.ok(!exported.includes("BOB_"));
        assert.ok(!exported.includes(sb.id));
        assert.ok(!exported.includes("ciphertext-only-fixture"));
        assert.ok(
          !JSON.stringify(await store.listModels()).includes(
            "ciphertext-only-fixture",
          ),
        );
        assert.ok(
          !JSON.stringify(await store.listAccounts()).includes("hash-"),
        );
      },
    );

    await t.test(
      "parallel admission is idempotent and rejects foreign sessions and simultaneous user jobs",
      async () => {
        const input = {
          userId: alice.id,
          sessionId: sa.id,
          modelId: model.id,
          content: "hello",
          idempotencyKey: "same-request",
        };
        const [first, second] = await Promise.all([
          store.enqueueJob(input, 10),
          store.enqueueJob(input, 10),
        ]);
        assert.equal(first.id, second.id);
        assert.equal((await a.dailyJobUsage()).used, 1);
        assert.equal(await b.getJob(first.id), null);
        assert.equal(await b.requestCancelJob(first.id), null);
        await assert.rejects(
          store.enqueueJob({ ...input, content: "different" }, 10),
          (e) => e instanceof StoreError && e.status === 409,
        );
        await assert.rejects(
          store.enqueueJob({ ...input, idempotencyKey: "second" }, 10),
          (e) => e instanceof StoreError && e.status === 409,
        );
        await assert.rejects(
          store.enqueueJob(
            { ...input, userId: bob.id, idempotencyKey: "foreign" },
            10,
          ),
          (e) => e instanceof StoreError && e.status === 404,
        );
        await assert.rejects(
          b.enqueueJob(input, 10),
          (e) => e instanceof StoreError && e.status === 403,
        );
        await assert.rejects(
          a.deleteSession(sa.id),
          (e) => e instanceof StoreError && e.status === 409,
        );
        assert.equal((await a.requestCancelJob(first.id))?.status, "cancelled");
        await assert.rejects(
          store.enqueueJob({ ...input, idempotencyKey: "over-quota" }, 1),
          (e) => e instanceof StoreError && e.status === 429,
        );
      },
    );

    await t.test(
      "queue is bounded across users and claims exactly once",
      async () => {
        const ja = await store.enqueueJob(
          {
            userId: alice.id,
            sessionId: sa.id,
            modelId: model.id,
            content: "queued A",
            idempotencyKey: "queue-a",
          },
          10,
          1,
        );
        await assert.rejects(
          store.enqueueJob(
            {
              userId: bob.id,
              sessionId: sb.id,
              modelId: model.id,
              content: "queued B",
              idempotencyKey: "queue-b",
            },
            10,
            1,
          ),
          (e) => e instanceof StoreError && e.status === 429,
        );
        const jb = await store.enqueueJob(
          {
            userId: bob.id,
            sessionId: sb.id,
            modelId: model.id,
            content: "queued B",
            idempotencyKey: "queue-b",
          },
          10,
          2,
        );
        const [claimedA, claimedB] = await Promise.all([
          store.claimNextJob(),
          store.claimNextJob(),
        ]);
        assert.equal(new Set([claimedA?.id, claimedB?.id]).size, 2);
        assert.deepEqual(
          new Set([claimedA?.id, claimedB?.id]),
          new Set([ja.id, jb.id]),
        );
        assert.equal(await store.claimNextJob(), null);
        await a.requestCancelJob(ja.id);
        const finishedA = await store.finishJob(
          ja.id,
          "failed",
          undefined,
          "failure after cancellation",
        );
        assert.equal(finishedA?.status, "cancelled");
        assert.equal(await store.finishJob(ja.id, "completed"), null);
        const release = await store.acquireRunLock();
        assert.ok(release);
        try {
          assert.equal(await store.recoverJobs(), 1);
        } finally {
          await release();
        }
        assert.equal((await b.getJob(jb.id))?.status, "failed");
      },
    );

    await t.test(
      "completed jobs survive reopen, deletion erases results but preserves daily quota",
      async () => {
        const jobSession = await a.createSession({ title: "delete later" });
        const queued = await store.enqueueJob(
          {
            userId: alice.id,
            sessionId: jobSession.id,
            modelId: model.id,
            content: "private prompt",
            idempotencyKey: "success",
          },
          10,
        );
        assert.equal((await store.claimNextJob())?.id, queued.id);
        const run = await a.createRun(jobSession.id, model.id);
        const msg = await a.addMessage(
          jobSession.id,
          "assistant",
          "private result",
        );
        const result: RunResult = {
          runId: run.id,
          message: msg,
          events: [],
          memoryCandidates: [],
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            estimatedCost: 0.001,
            currency: "CNY",
            usageSource: "provider",
          },
        };
        await store.finishJob(queued.id, "completed", result);
        assert.equal(
          (await a.getJob(queued.id))?.result?.message.content,
          "private result",
        );
        const before = (await a.dailyJobUsage()).used;
        await a.deleteSession(jobSession.id);
        const deleted = await a.getJob(queued.id);
        assert.equal(deleted?.content, "");
        assert.equal(deleted?.result, undefined);
        assert.equal((await a.dailyJobUsage()).used, before);
        assert.equal(await b.getJob(queued.id), null);
      },
    );

    await t.test(
      "password reset and disabling revoke cookies; disabling also cancels queued work",
      async () => {
        await store.addAuthSession(
          "alice-cookie",
          new Date(Date.now() + 60000),
          alice.id,
        );
        assert.equal((await store.authUser("alice-cookie"))?.id, alice.id);
        await store.updateAccount(alice.id, {
          passwordHash: "replacement-password-hash",
        });
        assert.equal(await store.authUser("alice-cookie"), null);
        assert.equal(
          await store.addAuthSession(
            "stale-login-cookie",
            new Date(Date.now() + 60000),
            alice.id,
            "hash-alice",
          ),
          false,
        );
        assert.equal(await store.authUser("stale-login-cookie"), null);
        assert.equal(
          await store.addAuthSession(
            "fresh-login-cookie",
            new Date(Date.now() + 60000),
            alice.id,
            "replacement-password-hash",
          ),
          true,
        );
        assert.equal(
          (await store.accountByUsername("ALICE"))?.passwordHash,
          "replacement-password-hash",
        );
        assert.equal(
          await store.updateAccount(
            alice.id,
            { passwordHash: "stale-self-reset" },
            "hash-alice",
          ),
          null,
        );
        assert.equal(
          (await store.accountByUsername("alice"))?.passwordHash,
          "replacement-password-hash",
        );
        assert.ok(await store.authUser("fresh-login-cookie"));
        assert.equal(
          await store.updateAccount(
            "owner",
            { passwordHash: "wrong-owner-hash" },
            "stale-owner-hash",
          ),
          null,
        );
        assert.equal(await store.ownerPassword(), "legacy-password-hash");
        const pending = await store.enqueueJob(
          {
            userId: bob.id,
            sessionId: sb.id,
            modelId: model.id,
            content: "stop when disabled",
            idempotencyKey: "disable",
          },
          10,
        );
        await store.addAuthSession(
          "bob-cookie",
          new Date(Date.now() + 60000),
          bob.id,
        );
        await store.updateAccount(bob.id, { disabled: true });
        assert.equal(await store.authUser("bob-cookie"), null);
        assert.equal(
          await store.updateAccount(
            bob.id,
            { passwordHash: "disabled-self-reset" },
            "hash-bob",
          ),
          null,
        );
        assert.equal((await b.getJob(pending.id))?.status, "cancelled");
        await assert.rejects(
          store.enqueueJob(
            {
              userId: bob.id,
              sessionId: sb.id,
              modelId: model.id,
              content: "disabled",
              idempotencyKey: "disabled",
            },
            10,
          ),
          (e) => e instanceof StoreError && e.status === 403,
        );
        await assert.rejects(
          store.updateAccount("owner", { disabled: true }),
          StoreError,
        );
        const settings = await store.updateSiteSettings({
          registrationOpen: true,
          dailyRunLimit: 7,
        });
        assert.deepEqual(settings, {
          registrationOpen: true,
          dailyRunLimit: 7,
        });
        await assert.rejects(
          a.updateSiteSettings({ registrationOpen: false }),
          StoreError,
        );
      },
    );

    await t.test(
      "login waits for a concurrent password reset and cannot mint a stale session",
      async () => {
        const client = await store.pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "UPDATE accounts SET password_hash=$2 WHERE id=$1",
            [alice.id, "concurrently-reset-hash"],
          );
          const login = store.addAuthSession(
            "concurrent-cookie",
            new Date(Date.now() + 60000),
            alice.id,
            "replacement-password-hash",
          );
          const state = await Promise.race([
            login,
            new Promise<string>((resolve) =>
              setTimeout(() => resolve("waiting"), 30),
            ),
          ]);
          assert.equal(state, "waiting");
          await client.query("COMMIT");
          assert.equal(await login, false);
          assert.equal(await store.authUser("concurrent-cookie"), null);
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
      },
    );

    await t.test(
      "losing the dedicated execution lock notifies the worker before another job can run",
      async () => {
        let notify!: () => void;
        const lost = new Promise<void>((resolve) => {
          notify = resolve;
        });
        const release = await store.acquireRunLock(notify);
        assert.ok(release);
        const lock = (
          await store.pool.query(
            "SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=713042602 AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND granted",
          )
        ).rows[0];
        assert.ok(lock);
        // Wait for backend termination, including advisory-lock cleanup.
        const terminated = await admin.query(
          "SELECT pg_terminate_backend($1, 5000) AS terminated",
          [lock.pid],
        );
        assert.equal(terminated.rows[0].terminated, true);
        await lost;
        await release();
        const next = await store.acquireRunLock();
        assert.ok(next);
        await next();
      },
    );
  },
);
