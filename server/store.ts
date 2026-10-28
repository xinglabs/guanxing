import { randomUUID } from "node:crypto";
import pg from "pg";
import type { ChartInput } from "../src/lib/chart";
import type {
  DailyUsage,
  Memory,
  Message,
  ModelProfile,
  RunSummary,
  Session,
  Usage,
} from "./types";
const { Pool } = pg;
type Row = Record<string, any>;
const iso = (date: Date | string) => new Date(date).toISOString();
const session = (r: Row): Session => ({
  id: r.id,
  title: r.title,
  birth: r.birth,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});
const message = (r: Row): Message => ({
  id: r.id,
  sessionId: r.session_id,
  role: r.role,
  content: r.content,
  createdAt: iso(r.created_at),
});
const memory = (r: Row): Memory => ({
  id: r.id,
  sessionId: r.session_id,
  content: r.content,
  status: r.status,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  hasEmbedding: Boolean(r.has_embedding ?? r.embedding),
});
const run = (r: Row): RunSummary => ({
  id: r.id,
  sessionId: r.session_id,
  modelId: r.model_id,
  status: r.status,
  steps: r.steps,
  createdAt: iso(r.created_at),
  events: r.events ?? [],
  ...(r.error ? { error: r.error } : {}),
});
const usage = (r: Row): Usage => ({
  id: r.id,
  runId: r.run_id,
  sessionId: r.session_id,
  modelId: r.model_id,
  modelName: r.model_name,
  inputTokens: Number(r.input_tokens),
  outputTokens: Number(r.output_tokens),
  totalTokens: Number(r.total_tokens),
  estimatedCost: Number(r.estimated_cost),
  currency: r.currency,
  usageSource: r.usage_source,
  status: r.status,
  createdAt: iso(r.created_at),
});
const vectorLiteral = (values: number[]) => {
  if (values.length !== 768 || values.some((v) => !Number.isFinite(v)))
    throw new Error("Embedding must contain 768 finite numbers.");
  return `[${values.join(",")}]`;
};

export class Store {
  readonly pool: pg.Pool;
  readonly timezone: string;
  constructor(connection: string | pg.Pool, timezone = "Asia/Shanghai") {
    this.pool =
      typeof connection === "string"
        ? new Pool({ connectionString: connection, max: 10 })
        : connection;
    this.timezone = timezone;
  }
  async close() {
    await this.pool.end();
  }
  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(713042601)");
      await client.query(`CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS owner_auth (id smallint PRIMARY KEY CHECK(id=1),password_hash text NOT NULL);
        CREATE TABLE IF NOT EXISTS auth_sessions (token_hash text PRIMARY KEY,expires_at timestamptz NOT NULL);
        CREATE TABLE IF NOT EXISTS models (id text PRIMARY KEY,profile jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS sessions (id text PRIMARY KEY,title text NOT NULL,birth jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS messages (id text PRIMARY KEY,session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,role text NOT NULL CHECK(role IN ('user','assistant')),content text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS runs (id text PRIMARY KEY,session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,model_id text NOT NULL,status text NOT NULL CHECK(status IN ('running','completed','failed','cancelled')),steps integer NOT NULL DEFAULT 0,error text,events jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS memories (id text PRIMARY KEY,session_id text REFERENCES sessions(id) ON DELETE CASCADE,content text NOT NULL,status text NOT NULL CHECK(status IN ('pending','active')),embedding vector(768),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS usage_ledger (id text PRIMARY KEY,run_id text NOT NULL,session_id text,model_id text NOT NULL,model_name text NOT NULL,input_tokens bigint NOT NULL CHECK(input_tokens>=0),output_tokens bigint NOT NULL CHECK(output_tokens>=0),total_tokens bigint NOT NULL CHECK(total_tokens>=0),estimated_cost numeric(20,10) NOT NULL CHECK(estimated_cost>=0),currency text NOT NULL CHECK(currency IN ('USD','CNY')),usage_source text NOT NULL CHECK(usage_source IN ('provider','estimate','unknown')),status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
        ALTER TABLE runs ADD COLUMN IF NOT EXISTS events jsonb NOT NULL DEFAULT '[]';
        CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id,created_at);
        CREATE INDEX IF NOT EXISTS runs_session_idx ON runs(session_id,created_at);
        CREATE INDEX IF NOT EXISTS memories_session_idx ON memories(session_id,status);
        CREATE INDEX IF NOT EXISTS usage_model_date_idx ON usage_ledger(model_id,created_at);
        CREATE INDEX IF NOT EXISTS memories_vector_idx ON memories USING hnsw (embedding vector_cosine_ops);`);
      const recoveryLock = await client.query(
        "SELECT pg_try_advisory_xact_lock(713042602) AS locked",
      );
      if (recoveryLock.rows[0].locked)
        await client.query(
          "UPDATE runs SET status='failed',error='服务重启，未完成的运行已中止。' WHERE status='running'",
        );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async hasOwner() {
    return Boolean(
      (await this.pool.query("SELECT 1 FROM owner_auth WHERE id=1")).rowCount,
    );
  }
  async ownerPassword() {
    return (
      await this.pool.query("SELECT password_hash FROM owner_auth WHERE id=1")
    ).rows[0]?.password_hash as string | undefined;
  }
  async setupOwner(passwordHash: string) {
    return Boolean(
      (
        await this.pool.query(
          "INSERT INTO owner_auth(id,password_hash) VALUES(1,$1) ON CONFLICT DO NOTHING RETURNING id",
          [passwordHash],
        )
      ).rowCount,
    );
  }
  async addAuthSession(hash: string, expires: Date) {
    await this.pool.query("DELETE FROM auth_sessions WHERE expires_at<now()");
    await this.pool.query(
      "INSERT INTO auth_sessions(token_hash,expires_at) VALUES($1,$2)",
      [hash, expires],
    );
  }
  async validAuthSession(hash: string) {
    return Boolean(
      (
        await this.pool.query(
          "SELECT 1 FROM auth_sessions WHERE token_hash=$1 AND expires_at>now()",
          [hash],
        )
      ).rowCount,
    );
  }
  async deleteAuthSession(hash: string) {
    await this.pool.query("DELETE FROM auth_sessions WHERE token_hash=$1", [
      hash,
    ]);
  }
  async listSessions() {
    return (
      await this.pool.query("SELECT * FROM sessions ORDER BY updated_at DESC")
    ).rows.map(session);
  }
  async createSession(
    input: { title?: string; birth?: ChartInput | null } = {},
  ) {
    const r = await this.pool.query(
      "INSERT INTO sessions(id,title,birth) VALUES($1,$2,$3) RETURNING *",
      [randomUUID(), input.title || "新的观星对话", input.birth || null],
    );
    return session(r.rows[0]);
  }
  async getSession(id: string) {
    const r = await this.pool.query("SELECT * FROM sessions WHERE id=$1", [id]);
    return r.rows[0] ? session(r.rows[0]) : null;
  }
  async deleteSession(id: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE usage_ledger SET session_id=NULL WHERE session_id=$1",
        [id],
      );
      const r = await client.query("DELETE FROM sessions WHERE id=$1", [id]);
      await client.query("COMMIT");
      return Boolean(r.rowCount);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async addMessage(sessionId: string, role: Message["role"], content: string) {
    const r = await this.pool.query(
      "INSERT INTO messages(id,session_id,role,content) VALUES($1,$2,$3,$4) RETURNING *",
      [randomUUID(), sessionId, role, content],
    );
    await this.pool.query("UPDATE sessions SET updated_at=now() WHERE id=$1", [
      sessionId,
    ]);
    return message(r.rows[0]);
  }
  async listMessages(sessionId: string) {
    return (
      await this.pool.query(
        "SELECT * FROM messages WHERE session_id=$1 ORDER BY created_at,id",
        [sessionId],
      )
    ).rows.map(message);
  }
  async listModels() {
    return (
      await this.pool.query("SELECT profile FROM models ORDER BY created_at,id")
    ).rows.map((r) => r.profile as ModelProfile);
  }
  async getModel(id: string) {
    return (
      ((await this.pool.query("SELECT profile FROM models WHERE id=$1", [id]))
        .rows[0]?.profile as ModelProfile | null) ?? null
    );
  }
  async saveModel(profile: Omit<ModelProfile, "id">, id?: string) {
    const key = id || randomUUID();
    const old = id ? await this.getModel(id) : null;
    if (id && !old) throw new Error("Model not found.");
    if (
      old &&
      old.currency !== profile.currency &&
      (
        await this.pool.query(
          "SELECT 1 FROM usage_ledger WHERE model_id=$1 LIMIT 1",
          [id],
        )
      ).rowCount
    )
      throw new Error("有用量记录的模型不能修改计价币种，请新建模型配置。");
    const model = { ...profile, id: key };
    await this.pool.query(
      "INSERT INTO models(id,profile) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET profile=EXCLUDED.profile",
      [key, model],
    );
    return model;
  }
  async deleteModel(id: string) {
    const old = await this.getModel(id);
    if (!old) return false;
    if (
      (
        await this.pool.query(
          "SELECT 1 FROM usage_ledger WHERE model_id=$1 LIMIT 1",
          [id],
        )
      ).rowCount
    ) {
      await this.pool.query(
        "UPDATE models SET profile=jsonb_set(profile,'{enabled}','false') WHERE id=$1",
        [id],
      );
    } else await this.pool.query("DELETE FROM models WHERE id=$1", [id]);
    return true;
  }
  async createRun(sessionId: string, modelId: string) {
    return run(
      (
        await this.pool.query(
          "INSERT INTO runs(id,session_id,model_id,status) VALUES($1,$2,$3,'running') RETURNING *",
          [randomUUID(), sessionId, modelId],
        )
      ).rows[0],
    );
  }
  async updateRun(
    id: string,
    patch: Partial<Pick<RunSummary, "status" | "steps" | "error" | "events">>,
  ) {
    const r = await this.pool.query(
      "UPDATE runs SET status=COALESCE($2,status),steps=COALESCE($3,steps),error=COALESCE($4,error),events=COALESCE($5::jsonb,events) WHERE id=$1 RETURNING *",
      [
        id,
        patch.status ?? null,
        patch.steps ?? null,
        patch.error ?? null,
        patch.events ? JSON.stringify(patch.events) : null,
      ],
    );
    return r.rows[0] ? run(r.rows[0]) : null;
  }
  async getRun(id: string) {
    const r = await this.pool.query("SELECT * FROM runs WHERE id=$1", [id]);
    return r.rows[0] ? run(r.rows[0]) : null;
  }
  async listRuns(sessionId: string) {
    return (
      await this.pool.query(
        "SELECT * FROM runs WHERE session_id=$1 ORDER BY created_at DESC",
        [sessionId],
      )
    ).rows.map(run);
  }
  async dailyUsage(modelId: string): Promise<DailyUsage> {
    const model = await this.getModel(modelId);
    const r = (
      await this.pool.query(
        "SELECT COALESCE(sum(input_tokens),0) AS input,COALESCE(sum(output_tokens),0) AS output,COALESCE(sum(total_tokens),0) AS total,COALESCE(sum(estimated_cost),0) AS cost FROM usage_ledger WHERE model_id=$1 AND (created_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date",
        [modelId, this.timezone],
      )
    ).rows[0];
    return {
      inputTokens: Number(r.input),
      outputTokens: Number(r.output),
      totalTokens: Number(r.total),
      estimatedCost: Number(r.cost),
      currency: model?.currency || "USD",
    };
  }
  async insertUsage(input: Omit<Usage, "id" | "createdAt">) {
    for (const field of [
      "inputTokens",
      "outputTokens",
      "totalTokens",
      "estimatedCost",
    ] as const)
      if (!Number.isFinite(input[field]) || input[field] < 0)
        throw new Error("Usage values must be finite and nonnegative.");
    return usage(
      (
        await this.pool.query(
          "INSERT INTO usage_ledger(id,run_id,session_id,model_id,model_name,input_tokens,output_tokens,total_tokens,estimated_cost,currency,usage_source,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
          [
            randomUUID(),
            input.runId,
            input.sessionId,
            input.modelId,
            input.modelName,
            input.inputTokens,
            input.outputTokens,
            input.totalTokens,
            input.estimatedCost,
            input.currency,
            input.usageSource,
            input.status,
          ],
        )
      ).rows[0],
    );
  }
  async updateUsage(
    id: string,
    patch: Pick<
      Usage,
      | "inputTokens"
      | "outputTokens"
      | "totalTokens"
      | "estimatedCost"
      | "usageSource"
      | "status"
    >,
  ) {
    for (const field of [
      "inputTokens",
      "outputTokens",
      "totalTokens",
      "estimatedCost",
    ] as const)
      if (!Number.isFinite(patch[field]) || patch[field] < 0)
        throw new Error("Usage values must be finite and nonnegative.");
    const r = await this.pool.query(
      "UPDATE usage_ledger SET input_tokens=$2,output_tokens=$3,total_tokens=$4,estimated_cost=$5,usage_source=$6,status=$7 WHERE id=$1 RETURNING *",
      [
        id,
        patch.inputTokens,
        patch.outputTokens,
        patch.totalTokens,
        patch.estimatedCost,
        patch.usageSource,
        patch.status,
      ],
    );
    if (!r.rows[0]) throw new Error("Usage entry not found.");
    return usage(r.rows[0]);
  }
  async listMemories(
    options: {
      sessionId?: string;
      status?: Memory["status"];
      limit?: number;
    } = {},
  ) {
    const r = await this.pool.query(
      "SELECT *,embedding IS NOT NULL AS has_embedding FROM memories WHERE ($1::text IS NULL OR session_id=$1 OR session_id IS NULL) AND ($2::text IS NULL OR status=$2) ORDER BY updated_at DESC LIMIT $3",
      [
        options.sessionId ?? null,
        options.status ?? null,
        Math.min(options.limit ?? 500, 2000),
      ],
    );
    return r.rows.map(memory);
  }
  async getMemory(id: string) {
    const r = await this.pool.query(
      "SELECT *,embedding IS NOT NULL AS has_embedding FROM memories WHERE id=$1",
      [id],
    );
    return r.rows[0] ? memory(r.rows[0]) : null;
  }
  async addMemory(input: {
    content: string;
    sessionId?: string | null;
    status?: Memory["status"];
  }) {
    return memory(
      (
        await this.pool.query(
          "INSERT INTO memories(id,session_id,content,status) VALUES($1,$2,$3,$4) RETURNING *,false AS has_embedding",
          [
            randomUUID(),
            input.sessionId ?? null,
            input.content,
            input.status ?? "pending",
          ],
        )
      ).rows[0],
    );
  }
  async updateMemory(
    id: string,
    patch: { content?: string; status?: Memory["status"] },
  ) {
    const r = await this.pool.query(
      "UPDATE memories SET content=COALESCE($2,content),status=COALESCE($3,status),embedding=CASE WHEN $2::text IS NULL OR $2=content THEN embedding ELSE NULL END,updated_at=now() WHERE id=$1 RETURNING *,embedding IS NOT NULL AS has_embedding",
      [id, patch.content ?? null, patch.status ?? null],
    );
    return r.rows[0] ? memory(r.rows[0]) : null;
  }
  async deleteMemory(id: string) {
    return Boolean(
      (await this.pool.query("DELETE FROM memories WHERE id=$1", [id]))
        .rowCount,
    );
  }
  async setMemoryEmbedding(
    id: string,
    embedding: number[] | null,
    expectedContent?: string,
  ) {
    await this.pool.query(
      "UPDATE memories SET embedding=$2::vector WHERE id=$1 AND ($3::text IS NULL OR content=$3)",
      [
        id,
        embedding ? vectorLiteral(embedding) : null,
        expectedContent ?? null,
      ],
    );
  }
  async searchMemories(
    query: string,
    sessionId?: string,
    embedding?: number[],
    limit = 5,
  ) {
    const scope = sessionId ?? null;
    const count = Math.max(1, Math.min(limit, 20));
    if (embedding) {
      const r = await this.pool.query(
        "SELECT *,true AS has_embedding FROM memories WHERE status='active' AND embedding IS NOT NULL AND ($1::text IS NULL OR session_id=$1 OR session_id IS NULL) ORDER BY embedding <=> $2::vector LIMIT $3",
        [scope, vectorLiteral(embedding), count],
      );
      if (r.rows.length) return r.rows.map(memory);
    }
    const text = query.trim().slice(0, 1000);
    const r = await this.pool.query(
      "SELECT *,embedding IS NOT NULL AS has_embedding FROM memories WHERE status='active' AND ($1::text IS NULL OR session_id=$1 OR session_id IS NULL) AND ($2='' OR strpos(lower(content),lower($2))>0) ORDER BY updated_at DESC LIMIT $3",
      [scope, text, count],
    );
    return r.rows.map(memory);
  }
  async listUsage(limit = 500) {
    return (
      await this.pool.query(
        "SELECT * FROM usage_ledger ORDER BY created_at DESC LIMIT $1",
        [Math.min(limit, 10000)],
      )
    ).rows.map(usage);
  }
  async dashboard() {
    const counts = (
      await this.pool.query(
        "SELECT (SELECT count(*) FROM sessions) AS sessions,(SELECT count(*) FROM memories) AS memories,(SELECT count(*) FROM runs) AS runs",
      )
    ).rows[0];
    const today = (
      await this.pool.query(
        "SELECT COALESCE(sum(input_tokens),0) AS input,COALESCE(sum(output_tokens),0) AS output,COALESCE(sum(total_tokens),0) AS total FROM usage_ledger WHERE (created_at AT TIME ZONE $1)::date=(now() AT TIME ZONE $1)::date",
        [this.timezone],
      )
    ).rows[0];
    const costs = (
      await this.pool.query(
        "SELECT currency,sum(estimated_cost) AS amount FROM usage_ledger WHERE (created_at AT TIME ZONE $1)::date=(now() AT TIME ZONE $1)::date GROUP BY currency",
        [this.timezone],
      )
    ).rows.map((r) => ({ currency: r.currency, amount: Number(r.amount) }));
    return {
      sessions: Number(counts.sessions),
      memories: Number(counts.memories),
      runs: Number(counts.runs),
      today: {
        inputTokens: Number(today.input),
        outputTokens: Number(today.output),
        totalTokens: Number(today.total),
      },
      costs,
      models: await this.listModels(),
      usage: await this.listUsage(),
    };
  }
  async exportData() {
    return {
      sessions: await this.listSessions(),
      runs: (
        await this.pool.query("SELECT * FROM runs ORDER BY created_at")
      ).rows.map(run),
      messages: (
        await this.pool.query("SELECT * FROM messages ORDER BY created_at")
      ).rows.map(message),
      memories: (
        await this.pool.query(
          "SELECT *,embedding IS NOT NULL AS has_embedding FROM memories ORDER BY created_at",
        )
      ).rows.map(memory),
      usage: (
        await this.pool.query("SELECT * FROM usage_ledger ORDER BY created_at")
      ).rows.map(usage),
      models: await this.listModels(),
    };
  }
  /** A dedicated DB connection holds the lock until release, including across replicas. */
  async acquireRunLock(): Promise<(() => Promise<void>) | null> {
    const client = await this.pool.connect();
    try {
      const r = await client.query(
        "SELECT pg_try_advisory_lock(713042602) AS locked",
      );
      if (!r.rows[0].locked) {
        client.release();
        return null;
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await client.query("SELECT pg_advisory_unlock(713042602)");
        } finally {
          client.release();
        }
      };
    } catch (e) {
      client.release();
      throw e;
    }
  }
}
