import { runAgent } from "./agent";
import type { Store } from "./store";
import type { CredentialVault } from "./vault";

/** One active model task suits a 2GB host. Other users wait in PostgreSQL, not HTTP sockets. */
export class JobWorker {
  private timer?: ReturnType<typeof setInterval>;
  private stopping = false;
  private pending?: Promise<void>;
  private controller?: AbortController;
  private activeId?: string;
  constructor(
    private store: Store,
    private vault: CredentialVault,
    private runner = runAgent,
  ) {}
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.wake(), 800);
    this.timer.unref();
    this.wake();
  }
  wake() {
    if (this.stopping || this.pending) return;
    this.pending = this.tick()
      .catch(() => {
        // No request data or provider response is written to logs.
        process.stderr.write(
          "Agent queue temporarily unavailable; will retry.\n",
        );
      })
      .finally(() => {
        this.pending = undefined;
      });
  }
  cancel(id: string) {
    if (this.activeId === id) this.controller?.abort();
  }
  async stop() {
    this.stopping = true;
    clearInterval(this.timer);
    this.controller?.abort();
    await this.pending;
  }
  private async tick() {
    const controller = new AbortController();
    this.controller = controller;
    const release = await this.store.acquireRunLock(() => controller.abort());
    if (!release) return;
    try {
      if (this.stopping || controller.signal.aborted) return;
      // Acquiring the same cross-process lock proves no earlier worker is still executing.
      await this.store.recoverJobs();
      if (this.stopping || controller.signal.aborted) return;
      const job = await this.store.claimNextJob();
      if (!job) return;
      const scoped = this.store.forUser(job.userId);
      this.activeId = job.id;
      this.controller = controller;
      let checking = false;
      const watch = setInterval(() => {
        if (checking) return;
        checking = true;
        void Promise.all([
          scoped.getJob(job.id),
          this.store.getAccount(job.userId),
        ])
          .then(([current, account]) => {
            if (
              !current ||
              current.cancelRequested ||
              !account ||
              account.disabled
            )
              controller.abort();
          })
          .catch(() => controller.abort())
          .finally(() => {
            checking = false;
          });
      }, 750);
      const timeout = setTimeout(() => controller.abort(), 125000);
      try {
        const account = await this.store.getAccount(job.userId);
        if (!account || account.disabled) throw new Error("Account disabled.");
        const model = await scoped.getModel(job.modelId);
        const encrypted = await this.store.getModelSecret(job.modelId);
        if (!model?.enabled || !encrypted || model.dailyTokenLimit <= 0)
          throw new Error("Hosted model not ready.");
        const apiKey = this.vault.decrypt(job.modelId, encrypted);
        if (this.stopping || controller.signal.aborted)
          throw new Error("Worker interrupted.");
        const result = await this.runner({
          store: scoped,
          sessionId: job.sessionId,
          content: job.content,
          modelId: job.modelId,
          apiKey,
          signal: controller.signal,
          controlledThinking: true,
        });
        const latest = await scoped.getJob(job.id);
        if (controller.signal.aborted || latest?.cancelRequested)
          await this.store.finishJob(
            job.id,
            "cancelled",
            undefined,
            "已停止本次解读。",
          );
        else await this.store.finishJob(job.id, "completed", result);
      } catch (error) {
        const text = (error as { publicMessage?: string })?.publicMessage;
        await this.store.finishJob(
          job.id,
          controller.signal.aborted ? "cancelled" : "failed",
          undefined,
          controller.signal.aborted
            ? "任务已停止。已发生的模型用量仍会记账。"
            : text || "本次解读未完成，请稍后重试或联系管理员检查模型配置。",
        );
      } finally {
        clearInterval(watch);
        clearTimeout(timeout);
        this.controller = undefined;
        this.activeId = undefined;
      }
    } finally {
      await release();
    }
  }
}
