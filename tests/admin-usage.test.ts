import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { Store } from "../server/store";

test(
  "system reports aggregate all rows by local day; limits belong to individual users",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const admin = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    const name = "guanxing_admin_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = "/" + name;
    const store = new Store(url.toString());
    t.after(async () => {
      await store.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    });
    await store.migrate();
    await store.setupOwner("test-password-hash", "admin");
    const alice = await store.createAccount({
      username: "alice",
      passwordHash: "hash-a",
    });
    const bob = await store.createAccount({
      username: "bob",
      passwordHash: "hash-b",
    });
    const a = store.forUser(alice.id),
      b = store.forUser(bob.id);
    const sa = await a.createSession({ title: "a" }),
      sb = await b.createSession({ title: "b" });
    const model = await store.saveModel({
      name: "mock",
      baseUrl: "https://api.deepseek.com/v1",
      model: "mock",
      enabled: true,
      inputPricePerMillion: 1,
      outputPricePerMillion: 2,
      currency: "CNY",
      dailyTokenLimit: 1000000,
      dailyCostLimit: 0,
    });
    await t.test(
      "more than 500 calls, timezone boundaries, currencies and deleted charts remain accurate",
      async () => {
        await store.pool.query(
          `INSERT INTO usage_ledger(id,run_id,session_id,model_id,model_name,input_tokens,output_tokens,total_tokens,estimated_cost,currency,usage_source,status,user_id,created_at)
      SELECT 'a-'||n,'run-a',$1,$2,'mock',10,2,12,0.01,'CNY','provider','completed',$3,'2001-01-01T16:00:00Z'::timestamptz FROM generate_series(1,501) n`,
          [sa.id, model.id, alice.id],
        );
        await store.pool.query(
          `INSERT INTO usage_ledger(id,run_id,session_id,model_id,model_name,input_tokens,output_tokens,total_tokens,estimated_cost,currency,usage_source,status,user_id,created_at)
      VALUES ('b-old','run-b',$1,$2,'mock',20,3,23,0.2,'USD','unknown','failed',$3,'2001-01-01T15:59:59Z'),
             ('b-today','run-b',$1,$2,'mock',40,4,44,0.4,'USD','estimate','completed',$3,'2001-01-02T15:59:59Z')`,
          [sb.id, model.id, bob.id],
        );
        const report = await store.adminUsageReport("2001-01-02");
        assert.equal(report.daily.calls, 502);
        assert.equal(report.daily.totalTokens, 501 * 12 + 44);
        assert.equal(report.allTime.totalTokens, 501 * 12 + 44 + 23);
        assert.equal(report.daily.unverifiedCalls, 1);
        assert.equal(
          report.users.find((u) => u.userId === alice.id)?.calls,
          501,
        );
        assert.equal(
          report.users.find((u) => u.userId === bob.id)?.totalTokens,
          44,
        );
        assert.deepEqual(report.daily.costs, [
          { currency: "CNY", amount: 5.01 },
          { currency: "USD", amount: 0.4 },
        ]);
        assert.equal(
          (await store.adminUsageReport("2001-01-01")).daily.totalTokens,
          23,
        );
        await a.deleteSession(sa.id);
        await store.updateAccount(bob.id, { disabled: true });
        assert.equal(
          (await store.adminUsageReport("2001-01-02")).daily.totalTokens,
          report.daily.totalTokens,
        );
        assert.equal(
          (await store.adminUsageReport("2001-01-03")).daily.totalTokens,
          0,
        );
        await assert.rejects(a.adminUsageReport("2001-01-02"), /管理员/);
        await assert.rejects(store.adminUsageReport("2001-02-29"));
        await store.updateAccount(bob.id, { disabled: false });
      },
    );
    await t.test(
      "independent request caps, idempotent retries and token totals across models",
      async () => {
        const sa2 = await a.createSession({ title: "a2" });
        await store.updateAccountLimits(alice.id, 1, 100);
        await store.updateAccountLimits(bob.id, 2, 0);
        const input = {
          userId: alice.id,
          sessionId: sa2.id,
          modelId: model.id,
          content: "hello",
          idempotencyKey: randomUUID(),
        };
        const job = await a.enqueueJob(input, 10);
        assert.equal((await a.enqueueJob(input, 10)).id, job.id);
        await a.requestCancelJob(job.id);
        await assert.rejects(
          a.enqueueJob({ ...input, idempotencyKey: randomUUID() }, 10),
          { status: 429 },
        );
        for (let i = 0; i < 2; i++) {
          const next = await b.enqueueJob(
            {
              ...input,
              userId: bob.id,
              sessionId: sb.id,
              idempotencyKey: randomUUID(),
            },
            10,
          );
          await b.requestCancelJob(next.id);
        }
        await assert.rejects(
          b.enqueueJob(
            {
              ...input,
              userId: bob.id,
              sessionId: sb.id,
              idempotencyKey: randomUUID(),
            },
            10,
          ),
          { status: 429 },
        );
        await store.updateAccountLimits(alice.id, 10, 100);
        for (const id of [model.id, "another-model"])
          await a.insertUsage({
            runId: "synthetic",
            sessionId: sa2.id,
            modelId: id,
            modelName: "mock",
            inputTokens: 40,
            outputTokens: 10,
            totalTokens: 50,
            estimatedCost: 0,
            currency: "CNY",
            usageSource: "unknown",
            status: "reserved",
          });
        assert.deepEqual(await a.dailyUserBudget(), { limit: 100, used: 100 });
        assert.equal((await b.dailyUserBudget()).used, 0);
        await assert.rejects(
          a.enqueueJob({ ...input, idempotencyKey: randomUUID() }, 10),
          { status: 429 },
        );
        await store.updateAccountLimits(alice.id, 10, 101);
        assert.equal((await a.dailyUserBudget()).used, 100);
        await store.updateAccountLimits(alice.id, 0, 0);
        await assert.rejects(
          a.enqueueJob({ ...input, idempotencyKey: randomUUID() }, 10),
          { status: 429 },
        );
        await assert.rejects(a.updateAccountLimits(bob.id, 999, 0));
        await assert.rejects(store.updateAccountLimits(alice.id, -1, 0));
        await assert.rejects(store.updateAccountLimits("owner", 10, 0));
      },
    );
  },
);
