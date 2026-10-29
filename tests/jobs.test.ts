import assert from "node:assert/strict";
import test from "node:test";
import type { runAgent } from "../server/agent";
import { JobWorker } from "../server/jobs";
import { CredentialVault } from "../server/vault";
import type { Store } from "../server/store";
import type { AgentJob, JobStatus } from "../server/public-types";
import type { RunResult } from "../server/types";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const key = "fake-job-worker-provider-key";
  const vault = new CredentialVault("d".repeat(64));
  const item: AgentJob = {
    id: "job-1",
    userId: "user-1",
    sessionId: "session-1",
    modelId: "model-1",
    content: "fixture question",
    idempotencyKey: "request-1",
    status: "queued",
    cancelRequested: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const state = {
    locks: 0,
    recoveries: 0,
    claims: 0,
    releases: 0,
    calls: 0,
    lost: (() => {}) as () => void,
    onRelease: (() => {}) as () => void,
    onFinish: (() => {}) as () => void,
    finishes: [] as Array<{
      status: JobStatus;
      result?: RunResult;
      error?: string;
    }>,
  };
  const scoped = {
    getJob: async () => ({ ...item }),
    getModel: async () => ({
      id: item.modelId,
      enabled: true,
      dailyTokenLimit: 1000,
    }),
  };
  const store = {
    acquireRunLock: async (onLost?: () => void) => {
      state.locks++;
      state.lost = onLost ?? (() => {});
      return async () => {
        state.releases++;
        state.onRelease();
      };
    },
    recoverJobs: async () => {
      state.recoveries++;
      return 0;
    },
    claimNextJob: async () => {
      state.claims++;
      if (item.status !== "queued") return null;
      item.status = "running";
      return { ...item };
    },
    forUser: (id: string) => {
      assert.equal(id, item.userId);
      return scoped;
    },
    getAccount: async () => ({ id: item.userId, disabled: false }),
    getModelSecret: async () => vault.encrypt(item.modelId, key),
    finishJob: async (
      id: string,
      status: JobStatus,
      result?: RunResult,
      error?: string,
    ) => {
      assert.equal(id, item.id);
      item.status = status;
      state.finishes.push({ status, result, error });
      state.onFinish();
      return { ...item };
    },
  };
  const runner: typeof runAgent = async () => {
    state.calls++;
    throw new Error("Unexpected model execution");
  };
  const worker = (run = runner) =>
    new JobWorker(store as unknown as Store, vault, run);
  return { key, vault, item, state, scoped, store, runner, worker };
}

for (const phase of ["lock", "recovery"] as const) {
  test(
    `worker stop during ${phase} acquisition does not start or claim paid work`,
    { timeout: 5000 },
    async () => {
      const f = fixture(),
        entered = deferred(),
        proceed = deferred();
      if (phase === "lock") {
        const acquire = f.store.acquireRunLock;
        f.store.acquireRunLock = async (onLost) => {
          entered.resolve();
          await proceed.promise;
          return acquire(onLost);
        };
      } else {
        f.store.recoverJobs = async () => {
          f.state.recoveries++;
          entered.resolve();
          await proceed.promise;
          return 0;
        };
      }
      const worker = f.worker();
      worker.wake();
      await entered.promise;
      const stopped = worker.stop();
      proceed.resolve();
      await stopped;
      assert.equal(f.state.claims, 0);
      assert.equal(f.state.calls, 0);
      assert.equal(f.item.status, "queued");
      assert.equal(f.state.releases, 1);
      worker.wake();
      assert.equal(f.state.locks, 1, "stopped workers do not resume on wake");
    },
  );
}

test(
  "losing the execution lock before the provider call cancels the claimed job without calling the model",
  { timeout: 5000 },
  async () => {
    const f = fixture(),
      entered = deferred(),
      proceed = deferred(),
      finished = deferred();
    f.store.getModelSecret = async () => {
      entered.resolve();
      await proceed.promise;
      return f.vault.encrypt(f.item.modelId, f.key);
    };
    f.state.onFinish = finished.resolve;
    const worker = f.worker();
    worker.wake();
    await entered.promise;
    f.state.lost();
    proceed.resolve();
    await finished.promise;
    await worker.stop();
    assert.equal(f.state.calls, 0);
    assert.equal(f.state.finishes.length, 1);
    assert.equal(f.state.finishes[0].status, "cancelled");
    assert.equal(f.item.status, "cancelled");
    assert.equal(f.state.releases, 1);
  },
);

test(
  "in-flight cancellation aborts the runner, persists one terminal result and is not retried by another worker",
  { timeout: 5000 },
  async () => {
    const f = fixture(),
      entered = deferred(),
      finished = deferred();
    const runner: typeof runAgent = async (args) => {
      f.state.calls++;
      assert.equal(args.apiKey, f.key);
      assert.equal(args.sessionId, f.item.sessionId);
      assert.equal(args.controlledThinking, true);
      assert.ok(args.signal);
      entered.resolve();
      return new Promise<RunResult>((_resolve, reject) => {
        const aborted = () =>
          reject(new Error(`Private provider diagnostic ${f.key}`));
        if (args.signal!.aborted) aborted();
        else args.signal!.addEventListener("abort", aborted, { once: true });
      });
    };
    f.state.onFinish = finished.resolve;
    const worker = f.worker(runner);
    worker.wake();
    await entered.promise;
    f.item.cancelRequested = true;
    worker.cancel(f.item.id);
    await finished.promise;
    await worker.stop();
    assert.equal(f.state.calls, 1);
    assert.equal(f.state.finishes.length, 1);
    assert.equal(f.state.finishes[0].status, "cancelled");
    assert.equal(f.state.finishes[0].result, undefined);
    assert.ok(!f.state.finishes[0].error?.includes(f.key));
    assert.equal(f.item.status, "cancelled");
    assert.equal(f.state.releases, 1);

    const nextReleased = deferred();
    f.state.onRelease = nextReleased.resolve;
    const restarted = f.worker(runner);
    restarted.wake();
    await nextReleased.promise;
    await restarted.stop();
    assert.equal(f.state.calls, 1);
    assert.equal(f.state.finishes.length, 1);
    assert.equal(f.state.releases, 2);
  },
);
