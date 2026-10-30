import { randomUUID } from "node:crypto";
import pg from "pg";
import type { ChartInput } from "../src/lib/chart";
import { StoreError } from "./public-types";
import type {
  Account,
  AccountCredentials,
  AgentJob,
  JobStatus,
  SiteSettings,
} from "./public-types";
import type {
  DailyUsage,
  Memory,
  Message,
  ModelProfile,
  RunSummary,
  RunResult,
  Session,
  Usage,
} from "./types";
const { Pool } = pg;
const observedPools = new WeakSet<pg.Pool>();
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
const account = (r: Row): Account => ({
  dailyRunLimit: r.daily_run_limit == null ? null : Number(r.daily_run_limit),
  dailyTokenLimit: Number(r.daily_token_limit || 0),
  id: r.id,
  username: r.username,
  role: r.role,
  disabled: r.disabled,
  createdAt: iso(r.created_at),
});
const job = (r: Row): AgentJob => ({
  id: r.id,
  userId: r.user_id,
  sessionId: r.session_id,
  modelId: r.model_id,
  content: r.content,
  idempotencyKey: r.idempotency_key,
  status: r.status,
  cancelRequested: r.cancel_requested,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  ...(r.run_id ? { runId: r.run_id } : {}),
  ...(r.error ? { error: r.error } : {}),
  ...(r.result ? { result: r.result as RunResult } : {}),
});
const vectorLiteral = (values: number[]) => {
  if (values.length !== 768 || values.some((v) => !Number.isFinite(v)))
    throw new Error("Embedding must contain 768 finite numbers.");
  return `[${values.join(",")}]`;
};

export class Store {
  readonly pool: pg.Pool;
  readonly timezone: string;
  readonly userId: string;
  private readonly ownsPool: boolean;
  constructor(
    connection: string | pg.Pool,
    timezone = "Asia/Shanghai",
    userId = "owner",
    ownsPool = true,
  ) {
    this.pool =
      typeof connection === "string"
        ? new Pool({ connectionString: connection, max: 10 })
        : connection;
    // Idle clients emit pool errors when PostgreSQL closes a connection.
    // The pool discards those clients; keep the server alive to reconnect on demand.
    if (!observedPools.has(this.pool)) {
      observedPools.add(this.pool);
      this.pool.on("error", () => {
        if (!this.pool.ending)
          process.stderr.write(
            "Database connection interrupted; a new connection will be used.\n",
          );
      });
    }
    this.timezone = timezone;
    this.userId = userId;
    this.ownsPool = ownsPool;
  }
  forUser(userId: string) {
    if (!userId) throw new StoreError(401, "请先登录。");
    return new Store(this.pool, this.timezone, userId, false);
  }
  private rootOnly() {
    if (!this.ownsPool) throw new StoreError(403, "需要管理员权限。");
  }
  async close() {
    if (this.ownsPool) await this.pool.end();
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
      await client.query(`
        CREATE TABLE IF NOT EXISTS accounts (
          id text PRIMARY KEY, username text NOT NULL UNIQUE,
          password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('admin','user')),
          disabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
        );
        INSERT INTO accounts(id,username,password_hash,role)
          SELECT 'owner','admin',password_hash,'admin' FROM owner_auth WHERE id=1
          ON CONFLICT(id) DO NOTHING;
        ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT 'owner';
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT 'owner';
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT 'owner';
        ALTER TABLE runs ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT 'owner';
        ALTER TABLE memories ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT 'owner';
        ALTER TABLE usage_ledger ADD COLUMN IF NOT EXISTS user_id text NOT NULL DEFAULT 'owner';
        CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
        CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id,updated_at);
        CREATE INDEX IF NOT EXISTS memories_user_idx ON memories(user_id,status,session_id);
        CREATE INDEX IF NOT EXISTS usage_user_date_idx ON usage_ledger(user_id,created_at);
        CREATE INDEX IF NOT EXISTS usage_date_idx ON usage_ledger(created_at);
        CREATE INDEX IF NOT EXISTS runs_user_date_idx ON runs(user_id,created_at);
        CREATE TABLE IF NOT EXISTS model_credentials (
          model_id text PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
          encrypted text NOT NULL
        );
        CREATE TABLE IF NOT EXISTS site_settings (
          id smallint PRIMARY KEY CHECK(id=1), registration_open boolean NOT NULL DEFAULT false,
          daily_run_limit integer NOT NULL DEFAULT 10 CHECK(daily_run_limit BETWEEN 1 AND 1000)
        );
        INSERT INTO site_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
        ALTER TABLE accounts ADD COLUMN IF NOT EXISTS daily_run_limit integer CHECK(daily_run_limit BETWEEN 0 AND 1000);
        ALTER TABLE accounts ADD COLUMN IF NOT EXISTS daily_token_limit bigint NOT NULL DEFAULT 0 CHECK(daily_token_limit BETWEEN 0 AND 1000000000);
        CREATE TABLE IF NOT EXISTS agent_jobs (
          id text PRIMARY KEY, user_id text NOT NULL REFERENCES accounts(id),
          session_id text NOT NULL, model_id text NOT NULL, content text NOT NULL,
          idempotency_key text NOT NULL, status text NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),
          cancel_requested boolean NOT NULL DEFAULT false, run_id text, error text, result jsonb,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE(user_id,idempotency_key)
        );
        CREATE INDEX IF NOT EXISTS jobs_pending_idx ON agent_jobs(status,created_at);
        CREATE INDEX IF NOT EXISTS jobs_user_date_idx ON agent_jobs(user_id,created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_user_idx ON agent_jobs(user_id)
          WHERE status IN ('queued','running');
      `);
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
  async setupOwner(passwordHash: string, username = "admin") {
    this.rootOnly();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "INSERT INTO owner_auth(id,password_hash) VALUES(1,$1) ON CONFLICT DO NOTHING RETURNING id",
        [passwordHash],
      );
      if (result.rowCount) {
        await client.query(
          "INSERT INTO accounts(id,username,password_hash,role) VALUES('owner',$1,$2,'admin')",
          [username.toLowerCase(), passwordHash],
        );
      }
      await client.query("COMMIT");
      return Boolean(result.rowCount);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async addAuthSession(
    hash: string,
    expires: Date,
    userId = "owner",
    expectedPasswordHash?: string,
  ): Promise<boolean> {
    await this.pool.query("DELETE FROM auth_sessions WHERE expires_at<now()");
    const result = await this.pool.query(
      // Lock the account row until insertion commits, so a concurrent reset either
      // revokes this new session or changes the hash before this predicate is checked.
      "INSERT INTO auth_sessions(token_hash,expires_at,user_id) SELECT $1,$2,id FROM accounts WHERE id=$3 AND NOT disabled AND ($4::text IS NULL OR password_hash=$4) FOR SHARE",
      [hash, expires, userId, expectedPasswordHash ?? null],
    );
    return Boolean(result.rowCount);
  }
  async validAuthSession(hash: string) {
    return Boolean(await this.authUser(hash));
  }
  async authUser(hash: string): Promise<Account | null> {
    const result = await this.pool.query(
      "SELECT a.* FROM auth_sessions s JOIN accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT a.disabled",
      [hash],
    );
    return result.rows[0] ? account(result.rows[0]) : null;
  }
  async deleteAuthSession(hash: string) {
    await this.pool.query("DELETE FROM auth_sessions WHERE token_hash=$1", [
      hash,
    ]);
  }
  async accountByUsername(
    username: string,
  ): Promise<AccountCredentials | null> {
    this.rootOnly();
    const result = await this.pool.query(
      "SELECT * FROM accounts WHERE username=$1",
      [username.toLowerCase()],
    );
    const row = result.rows[0];
    return row ? { ...account(row), passwordHash: row.password_hash } : null;
  }
  async getAccount(id: string) {
    this.rootOnly();
    const result = await this.pool.query("SELECT * FROM accounts WHERE id=$1", [
      id,
    ]);
    return result.rows[0] ? account(result.rows[0]) : null;
  }
  async createAccount(input: {
    username: string;
    passwordHash: string;
    role?: Account["role"];
  }) {
    this.rootOnly();
    const username = input.username.toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username))
      throw new StoreError(
        400,
        "用户名需为 3—32 位字母、数字、下划线或短横线。",
      );
    if (username === "admin" || username === "owner")
      throw new StoreError(409, "此用户名已保留，请换一个。");
    const result = await this.pool.query(
      "INSERT INTO accounts(id,username,password_hash,role) VALUES($1,$2,$3,$4) ON CONFLICT(username) DO NOTHING RETURNING *",
      [randomUUID(), username, input.passwordHash, input.role ?? "user"],
    );
    if (!result.rows[0]) throw new StoreError(409, "此用户名已被使用。");
    return account(result.rows[0]);
  }
  async listAccounts() {
    this.rootOnly();
    return (
      await this.pool.query("SELECT * FROM accounts ORDER BY created_at,id")
    ).rows.map(account);
  }
  async updateAccount(
    id: string,
    patch: { disabled?: boolean; passwordHash?: string },
    expectedPasswordHash?: string,
  ) {
    this.rootOnly();
    if (id === "owner" && patch.disabled)
      throw new StoreError(400, "不能停用初始管理员。");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "UPDATE accounts SET disabled=COALESCE($2,disabled),password_hash=COALESCE($3,password_hash) WHERE id=$1 AND ($4::text IS NULL OR (password_hash=$4 AND NOT disabled)) RETURNING *",
        [
          id,
          patch.disabled ?? null,
          patch.passwordHash ?? null,
          expectedPasswordHash ?? null,
        ],
      );
      if (
        result.rowCount &&
        (patch.disabled !== undefined || patch.passwordHash !== undefined)
      )
        await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [id]);
      if (result.rowCount && id === "owner" && patch.passwordHash !== undefined)
        await client.query(
          "UPDATE owner_auth SET password_hash=$1 WHERE id=1",
          [patch.passwordHash],
        );
      if (result.rowCount && patch.disabled) {
        await client.query(
          "UPDATE agent_jobs SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,cancel_requested=true,updated_at=now() WHERE user_id=$1 AND status IN ('queued','running')",
          [id],
        );
      }
      await client.query("COMMIT");
      return result.rows[0] ? account(result.rows[0]) : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async getSiteSettings(): Promise<SiteSettings> {
    const row = (
      await this.pool.query("SELECT * FROM site_settings WHERE id=1")
    ).rows[0];
    return {
      registrationOpen: row?.registration_open ?? false,
      dailyRunLimit: row?.daily_run_limit ?? 10,
    };
  }
  async updateAccountLimits(
    id: string,
    dailyRunLimit: number | null,
    dailyTokenLimit: number,
  ) {
    this.rootOnly();
    if (
      (dailyRunLimit !== null &&
        (!Number.isSafeInteger(dailyRunLimit) ||
          dailyRunLimit < 0 ||
          dailyRunLimit > 1000)) ||
      !Number.isSafeInteger(dailyTokenLimit) ||
      dailyTokenLimit < 0 ||
      dailyTokenLimit > 1000000000
    )
      throw new StoreError(
        400,
        "每日次数需为 0—1000，Token 上限需为 0—10 亿的整数。",
      );
    const result = await this.pool.query(
      "UPDATE accounts SET daily_run_limit=$2,daily_token_limit=$3 WHERE id=$1 AND role='user' RETURNING *",
      [id, dailyRunLimit, dailyTokenLimit],
    );
    if (!result.rows[0])
      throw new StoreError(400, "只能设置普通用户的使用上限。");
    return account(result.rows[0]);
  }
  async dailyUserBudget() {
    const result = await this.pool.query(
      `SELECT a.daily_token_limit AS limit,
      COALESCE((SELECT sum(total_tokens) FROM usage_ledger WHERE user_id=a.id
        AND (created_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date),0) AS used
      FROM accounts a WHERE a.id=$1`,
      [this.userId, this.timezone],
    );
    if (!result.rows[0]) throw new StoreError(403, "账号不存在。");
    return {
      limit: Number(result.rows[0].limit),
      used: Number(result.rows[0].used),
    };
  }
  async updateSiteSettings(patch: Partial<SiteSettings>) {
    this.rootOnly();
    if (
      patch.dailyRunLimit !== undefined &&
      (!Number.isSafeInteger(patch.dailyRunLimit) ||
        patch.dailyRunLimit < 1 ||
        patch.dailyRunLimit > 1000)
    )
      throw new StoreError(400, "每日次数需为 1—1000 的整数。");
    await this.pool.query(
      "UPDATE site_settings SET registration_open=COALESCE($1,registration_open),daily_run_limit=COALESCE($2,daily_run_limit) WHERE id=1",
      [patch.registrationOpen ?? null, patch.dailyRunLimit ?? null],
    );
    return this.getSiteSettings();
  }
  async listSessions() {
    return (
      await this.pool.query(
        "SELECT * FROM sessions WHERE user_id=$1 ORDER BY updated_at DESC",
        [this.userId],
      )
    ).rows.map(session);
  }
  async createSession(
    input: { title?: string; birth?: ChartInput | null } = {},
  ) {
    const r = await this.pool.query(
      "INSERT INTO sessions(id,title,birth,user_id) VALUES($1,$2,$3,$4) RETURNING *",
      [
        randomUUID(),
        input.title || "新的观星对话",
        input.birth || null,
        this.userId,
      ],
    );
    return session(r.rows[0]);
  }
  async getSession(id: string) {
    const r = await this.pool.query(
      "SELECT * FROM sessions WHERE id=$1 AND user_id=$2",
      [id, this.userId],
    );
    return r.rows[0] ? session(r.rows[0]) : null;
  }
  async deleteSession(id: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT id FROM sessions WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [id, this.userId],
      );
      if (!existing.rowCount) {
        await client.query("ROLLBACK");
        return false;
      }
      if (
        (
          await client.query(
            "SELECT 1 FROM agent_jobs WHERE session_id=$1 AND user_id=$2 AND status IN ('queued','running')",
            [id, this.userId],
          )
        ).rowCount
      )
        throw new StoreError(409, "请先停止此对话的任务，再删除对话。");
      await client.query(
        "UPDATE usage_ledger SET session_id=NULL WHERE session_id=$1 AND user_id=$2",
        [id, this.userId],
      );
      // Keep job counters after deletion, but erase the user's stored prompt and result.
      await client.query(
        "UPDATE agent_jobs SET content='',result=NULL WHERE session_id=$1 AND user_id=$2",
        [id, this.userId],
      );
      const r = await client.query(
        "DELETE FROM sessions WHERE id=$1 AND user_id=$2",
        [id, this.userId],
      );
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
      "INSERT INTO messages(id,session_id,role,content,user_id) SELECT $1,id,$3,$4,$5 FROM sessions WHERE id=$2 AND user_id=$5 RETURNING *",
      [randomUUID(), sessionId, role, content, this.userId],
    );
    if (!r.rows[0]) throw new StoreError(404, "对话不存在。");
    await this.pool.query(
      "UPDATE sessions SET updated_at=now() WHERE id=$1 AND user_id=$2",
      [sessionId, this.userId],
    );
    return message(r.rows[0]);
  }
  async listMessages(sessionId: string) {
    return (
      await this.pool.query(
        "SELECT * FROM messages WHERE session_id=$1 AND user_id=$2 ORDER BY created_at,id",
        [sessionId, this.userId],
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
    this.rootOnly();
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
    this.rootOnly();
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
  async setModelSecret(modelId: string, encrypted: string | null) {
    this.rootOnly();
    if (!(await this.getModel(modelId)))
      throw new StoreError(404, "模型配置不存在。");
    if (encrypted === null) {
      await this.pool.query("DELETE FROM model_credentials WHERE model_id=$1", [
        modelId,
      ]);
    } else {
      await this.pool.query(
        "INSERT INTO model_credentials(model_id,encrypted) VALUES($1,$2) ON CONFLICT(model_id) DO UPDATE SET encrypted=EXCLUDED.encrypted",
        [modelId, encrypted],
      );
    }
  }
  async getModelSecret(modelId: string): Promise<string | null> {
    this.rootOnly();
    return (
      (
        await this.pool.query(
          "SELECT encrypted FROM model_credentials WHERE model_id=$1",
          [modelId],
        )
      ).rows[0]?.encrypted ?? null
    );
  }
  async createRun(sessionId: string, modelId: string) {
    const result = await this.pool.query(
      "INSERT INTO runs(id,session_id,model_id,status,user_id) SELECT $1,id,$3,'running',$4 FROM sessions WHERE id=$2 AND user_id=$4 RETURNING *",
      [randomUUID(), sessionId, modelId, this.userId],
    );
    if (!result.rows[0]) throw new StoreError(404, "对话不存在。");
    return run(result.rows[0]);
  }
  async updateRun(
    id: string,
    patch: Partial<Pick<RunSummary, "status" | "steps" | "error" | "events">>,
  ) {
    const r = await this.pool.query(
      "UPDATE runs SET status=COALESCE($2,status),steps=COALESCE($3,steps),error=COALESCE($4,error),events=COALESCE($5::jsonb,events) WHERE id=$1 AND user_id=$6 RETURNING *",
      [
        id,
        patch.status ?? null,
        patch.steps ?? null,
        patch.error ?? null,
        patch.events ? JSON.stringify(patch.events) : null,
        this.userId,
      ],
    );
    return r.rows[0] ? run(r.rows[0]) : null;
  }
  async getRun(id: string) {
    const r = await this.pool.query(
      "SELECT * FROM runs WHERE id=$1 AND user_id=$2",
      [id, this.userId],
    );
    return r.rows[0] ? run(r.rows[0]) : null;
  }
  async listRuns(sessionId: string) {
    return (
      await this.pool.query(
        "SELECT * FROM runs WHERE session_id=$1 AND user_id=$2 ORDER BY created_at DESC",
        [sessionId, this.userId],
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
    if (input.sessionId && !(await this.getSession(input.sessionId)))
      throw new StoreError(404, "对话不存在。");
    // Legacy usage tests may use synthetic run IDs. Existing runs must still belong to this user.
    const parent = await this.pool.query(
      "SELECT user_id FROM runs WHERE id=$1",
      [input.runId],
    );
    if (parent.rows[0] && parent.rows[0].user_id !== this.userId)
      throw new StoreError(404, "运行记录不存在。");
    return usage(
      (
        await this.pool.query(
          "INSERT INTO usage_ledger(id,run_id,session_id,model_id,model_name,input_tokens,output_tokens,total_tokens,estimated_cost,currency,usage_source,status,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
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
            this.userId,
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
      "UPDATE usage_ledger SET input_tokens=$2,output_tokens=$3,total_tokens=$4,estimated_cost=$5,usage_source=$6,status=$7 WHERE id=$1 AND user_id=$8 RETURNING *",
      [
        id,
        patch.inputTokens,
        patch.outputTokens,
        patch.totalTokens,
        patch.estimatedCost,
        patch.usageSource,
        patch.status,
        this.userId,
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
      "SELECT *,embedding IS NOT NULL AS has_embedding FROM memories WHERE user_id=$4 AND ($1::text IS NULL OR session_id=$1 OR session_id IS NULL) AND ($2::text IS NULL OR status=$2) ORDER BY updated_at DESC LIMIT $3",
      [
        options.sessionId ?? null,
        options.status ?? null,
        Math.min(options.limit ?? 500, 2000),
        this.userId,
      ],
    );
    return r.rows.map(memory);
  }
  async getMemory(id: string) {
    const r = await this.pool.query(
      "SELECT *,embedding IS NOT NULL AS has_embedding FROM memories WHERE id=$1 AND user_id=$2",
      [id, this.userId],
    );
    return r.rows[0] ? memory(r.rows[0]) : null;
  }
  async addMemory(input: {
    content: string;
    sessionId?: string | null;
    status?: Memory["status"];
  }) {
    if (input.sessionId && !(await this.getSession(input.sessionId)))
      throw new StoreError(404, "对话不存在。");
    return memory(
      (
        await this.pool.query(
          "INSERT INTO memories(id,session_id,content,status,user_id) VALUES($1,$2,$3,$4,$5) RETURNING *,false AS has_embedding",
          [
            randomUUID(),
            input.sessionId ?? null,
            input.content,
            input.status ?? "pending",
            this.userId,
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
      "UPDATE memories SET content=COALESCE($2,content),status=COALESCE($3,status),embedding=CASE WHEN $2::text IS NULL OR $2=content THEN embedding ELSE NULL END,updated_at=now() WHERE id=$1 AND user_id=$4 RETURNING *,embedding IS NOT NULL AS has_embedding",
      [id, patch.content ?? null, patch.status ?? null, this.userId],
    );
    return r.rows[0] ? memory(r.rows[0]) : null;
  }
  async deleteMemory(id: string) {
    return Boolean(
      (
        await this.pool.query(
          "DELETE FROM memories WHERE id=$1 AND user_id=$2",
          [id, this.userId],
        )
      ).rowCount,
    );
  }
  async setMemoryEmbedding(
    id: string,
    embedding: number[] | null,
    expectedContent?: string,
  ) {
    await this.pool.query(
      "UPDATE memories SET embedding=$2::vector WHERE id=$1 AND user_id=$4 AND ($3::text IS NULL OR content=$3)",
      [
        id,
        embedding ? vectorLiteral(embedding) : null,
        expectedContent ?? null,
        this.userId,
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
        "SELECT *,true AS has_embedding FROM memories WHERE user_id=$4 AND status='active' AND embedding IS NOT NULL AND ($1::text IS NULL OR session_id=$1 OR session_id IS NULL) ORDER BY embedding <=> $2::vector LIMIT $3",
        [scope, vectorLiteral(embedding), count, this.userId],
      );
      if (r.rows.length) return r.rows.map(memory);
    }
    const text = query.trim().slice(0, 1000);
    const r = await this.pool.query(
      "SELECT *,embedding IS NOT NULL AS has_embedding FROM memories WHERE user_id=$4 AND status='active' AND ($1::text IS NULL OR session_id=$1 OR session_id IS NULL) AND ($2='' OR strpos(lower(content),lower($2))>0) ORDER BY updated_at DESC LIMIT $3",
      [scope, text, count, this.userId],
    );
    return r.rows.map(memory);
  }
  async listUsage(limit = 500) {
    return (
      await this.pool.query(
        "SELECT * FROM usage_ledger WHERE user_id=$2 ORDER BY created_at DESC LIMIT $1",
        [Math.min(limit, 10000), this.userId],
      )
    ).rows.map(usage);
  }
  async adminUsageReport(date?: string) {
    this.rootOnly();
    if (
      date !== undefined &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        date < "1900-01-01" ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    )
      throw new StoreError(400, "请选择有效日期，格式为 YYYY-MM-DD。");
    const selectedDate: string =
      date ||
      (
        await this.pool.query(
          "SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS day",
          [this.timezone],
        )
      ).rows[0].day;
    const totals = (rows: Row[]) => ({
      calls: rows.reduce((n, r) => n + Number(r.calls), 0),
      inputTokens: rows.reduce((n, r) => n + Number(r.input), 0),
      outputTokens: rows.reduce((n, r) => n + Number(r.output), 0),
      totalTokens: rows.reduce((n, r) => n + Number(r.total), 0),
      unverifiedCalls: rows.reduce((n, r) => n + Number(r.unverified), 0),
      costs: rows.map((r) => ({
        currency: r.currency as "CNY" | "USD",
        amount: Number(r.cost),
      })),
    });
    // Aggregate the complete ledger, independently of the paged request list.
    const [dailyRows, allRows, accountRows, requestRows] = await Promise.all([
      this.pool.query(
        `SELECT user_id,currency,count(*) AS calls,
        sum(input_tokens) AS input,sum(output_tokens) AS output,sum(total_tokens) AS total,
        sum(estimated_cost) AS cost,count(*) FILTER (WHERE usage_source <> 'provider') AS unverified
        FROM usage_ledger WHERE created_at >= ($1::date::timestamp AT TIME ZONE $2)
        AND created_at < (($1::date + 1)::timestamp AT TIME ZONE $2)
        GROUP BY user_id,currency ORDER BY user_id,currency`,
        [selectedDate, this.timezone],
      ),
      this.pool
        .query(`SELECT currency,count(*) AS calls,sum(input_tokens) AS input,
        sum(output_tokens) AS output,sum(total_tokens) AS total,sum(estimated_cost) AS cost,
        count(*) FILTER (WHERE usage_source <> 'provider') AS unverified
        FROM usage_ledger GROUP BY currency ORDER BY currency`),
      this.pool.query(
        "SELECT id,username,role,disabled FROM accounts ORDER BY username",
      ),
      this.pool.query(
        `SELECT user_id,count(*) AS requests FROM agent_jobs
        WHERE created_at >= ($1::date::timestamp AT TIME ZONE $2)
        AND created_at < (($1::date + 1)::timestamp AT TIME ZONE $2) GROUP BY user_id`,
        [selectedDate, this.timezone],
      ),
    ]);
    const grouped = new Map<string, Row[]>();
    for (const row of dailyRows.rows)
      grouped.set(row.user_id, [...(grouped.get(row.user_id) || []), row]);
    const requests = new Map(
      requestRows.rows.map((r) => [r.user_id, Number(r.requests)]),
    );
    const users = accountRows.rows.map((r) => ({
      userId: r.id as string,
      username: r.username as string,
      role: r.role as "admin" | "user",
      disabled: Boolean(r.disabled),
      requests: requests.get(r.id) || 0,
      ...totals(grouped.get(r.id) || []),
    }));
    // Preserve attribution if historical ledger rows outlive an account.
    const knownUsers = new Set(users.map((u) => u.userId));
    for (const [userId, rows] of grouped)
      if (!knownUsers.has(userId))
        users.push({
          userId,
          username: "历史账号",
          role: "user",
          disabled: true,
          requests: requests.get(userId) || 0,
          ...totals(rows),
        });
    users.sort(
      (a, b) =>
        b.totalTokens - a.totalTokens || a.username.localeCompare(b.username),
    );
    const daily = totals(dailyRows.rows);
    const costs = new Map<"CNY" | "USD", number>();
    for (const c of daily.costs)
      costs.set(c.currency, (costs.get(c.currency) || 0) + c.amount);
    daily.costs = Array.from(costs, ([currency, amount]) => ({
      currency,
      amount,
    })).sort((a, b) => a.currency.localeCompare(b.currency));
    return {
      date: selectedDate,
      timezone: this.timezone,
      daily,
      allTime: totals(allRows.rows),
      users,
    };
  }
  async dashboard() {
    return this.aggregateDashboard(this.userId);
  }
  async dashboardAll() {
    this.rootOnly();
    return this.aggregateDashboard(null);
  }
  private async aggregateDashboard(userId: string | null) {
    const counts = (
      await this.pool.query(
        "SELECT (SELECT count(*) FROM sessions WHERE ($1::text IS NULL OR user_id=$1)) AS sessions,(SELECT count(*) FROM memories WHERE ($1::text IS NULL OR user_id=$1)) AS memories,(SELECT count(*) FROM runs WHERE ($1::text IS NULL OR user_id=$1)) AS runs",
        [userId],
      )
    ).rows[0];
    const today = (
      await this.pool.query(
        "SELECT COALESCE(sum(input_tokens),0) AS input,COALESCE(sum(output_tokens),0) AS output,COALESCE(sum(total_tokens),0) AS total FROM usage_ledger WHERE ($2::text IS NULL OR user_id=$2) AND (created_at AT TIME ZONE $1)::date=(now() AT TIME ZONE $1)::date",
        [this.timezone, userId],
      )
    ).rows[0];
    const costs = (
      await this.pool.query(
        "SELECT currency,sum(estimated_cost) AS amount FROM usage_ledger WHERE ($2::text IS NULL OR user_id=$2) AND (created_at AT TIME ZONE $1)::date=(now() AT TIME ZONE $1)::date GROUP BY currency",
        [this.timezone, userId],
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
      usage: (
        await this.pool.query(
          "SELECT * FROM usage_ledger WHERE ($1::text IS NULL OR user_id=$1) ORDER BY created_at DESC LIMIT 500",
          [userId],
        )
      ).rows.map(usage),
    };
  }
  async exportData() {
    return {
      sessions: await this.listSessions(),
      runs: (
        await this.pool.query(
          "SELECT * FROM runs WHERE user_id=$1 ORDER BY created_at",
          [this.userId],
        )
      ).rows.map(run),
      messages: (
        await this.pool.query(
          "SELECT * FROM messages WHERE user_id=$1 ORDER BY created_at",
          [this.userId],
        )
      ).rows.map(message),
      memories: (
        await this.pool.query(
          "SELECT *,embedding IS NOT NULL AS has_embedding FROM memories WHERE user_id=$1 ORDER BY created_at",
          [this.userId],
        )
      ).rows.map(memory),
      usage: (
        await this.pool.query(
          "SELECT * FROM usage_ledger WHERE user_id=$1 ORDER BY created_at",
          [this.userId],
        )
      ).rows.map(usage),
      models: await this.listModels(),
    };
  }
  async dailyJobUsage(): Promise<{ used: number }> {
    const result = await this.pool.query(
      "SELECT count(*) AS count FROM agent_jobs WHERE user_id=$1 AND (created_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date",
      [this.userId, this.timezone],
    );
    return { used: Number(result.rows[0].count) };
  }
  async enqueueJob(
    input: {
      userId: string;
      sessionId: string;
      modelId: string;
      content: string;
      idempotencyKey: string;
    },
    dailyLimit: number,
    maxQueue = 100,
  ): Promise<AgentJob> {
    if (!this.ownsPool && input.userId !== this.userId)
      throw new StoreError(403, "不能为其他用户创建任务。");
    if (
      !Number.isInteger(dailyLimit) ||
      dailyLimit < 1 ||
      dailyLimit > 1000 ||
      !Number.isInteger(maxQueue) ||
      maxQueue < 1 ||
      maxQueue > 10000
    )
      throw new StoreError(400, "任务限额配置不正确。");
    if (
      !input.idempotencyKey ||
      input.idempotencyKey.length > 128 ||
      !input.content.trim() ||
      input.content.length > 12000
    )
      throw new StoreError(400, "任务内容或请求标识不正确。");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize admission, not execution: quotas and the queue bound are checked atomically.
      await client.query("SELECT pg_advisory_xact_lock(713042603)");
      const actor = (
        await client.query(
          "SELECT id,daily_run_limit,daily_token_limit FROM accounts WHERE id=$1 AND NOT disabled FOR SHARE",
          [input.userId],
        )
      ).rows[0];
      if (!actor) throw new StoreError(403, "账号不可用，请重新登录。");
      const previous = (
        await client.query(
          "SELECT * FROM agent_jobs WHERE user_id=$1 AND idempotency_key=$2",
          [input.userId, input.idempotencyKey],
        )
      ).rows[0];
      if (previous) {
        if (
          previous.session_id !== input.sessionId ||
          previous.model_id !== input.modelId ||
          previous.content !== input.content
        )
          throw new StoreError(409, "请求标识已用于另一个任务，请重新提交。");
        await client.query("COMMIT");
        return job(previous);
      }
      if (
        !(
          await client.query(
            "SELECT id FROM sessions WHERE id=$1 AND user_id=$2 FOR UPDATE",
            [input.sessionId, input.userId],
          )
        ).rowCount
      )
        throw new StoreError(404, "对话不存在。");
      const profile = (
        await client.query("SELECT profile FROM models WHERE id=$1", [
          input.modelId,
        ])
      ).rows[0]?.profile as ModelProfile | undefined;
      if (!profile?.enabled) throw new StoreError(400, "请选择已启用的模型。");
      if (
        (
          await client.query(
            "SELECT 1 FROM agent_jobs WHERE user_id=$1 AND status IN ('queued','running')",
            [input.userId],
          )
        ).rowCount
      )
        throw new StoreError(
          409,
          "你已有一个任务在排队或生成中，请先等待完成。",
        );
      const used = Number(
        (
          await client.query(
            "SELECT count(*) AS count FROM agent_jobs WHERE user_id=$1 AND (created_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date",
            [input.userId, this.timezone],
          )
        ).rows[0].count,
      );
      if (used >= (actor.daily_run_limit ?? dailyLimit))
        throw new StoreError(
          429,
          "今天的解读暂时告一段落，请明天再来，或联系管理员。",
        );
      if (Number(actor.daily_token_limit) > 0) {
        const total = (
          await client.query(
            `SELECT COALESCE(sum(total_tokens),0) AS used
          FROM usage_ledger WHERE user_id=$1 AND (created_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date`,
            [input.userId, this.timezone],
          )
        ).rows[0];
        if (Number(total.used) >= Number(actor.daily_token_limit))
          throw new StoreError(
            429,
            "今天的解读暂时告一段落，请明天再来，或联系管理员。",
          );
      }
      const queued = Number(
        (
          await client.query(
            "SELECT count(*) AS count FROM agent_jobs WHERE status IN ('queued','running')",
          )
        ).rows[0].count,
      );
      if (queued >= maxQueue)
        throw new StoreError(429, "当前排队人数较多，请稍后再试。");
      const result = await client.query(
        "INSERT INTO agent_jobs(id,user_id,session_id,model_id,content,idempotency_key,status) VALUES($1,$2,$3,$4,$5,$6,'queued') RETURNING *",
        [
          randomUUID(),
          input.userId,
          input.sessionId,
          input.modelId,
          input.content,
          input.idempotencyKey,
        ],
      );
      await client.query("COMMIT");
      return job(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async getJob(id: string): Promise<AgentJob | null> {
    const result = await this.pool.query(
      "SELECT * FROM agent_jobs WHERE id=$1 AND user_id=$2",
      [id, this.userId],
    );
    return result.rows[0] ? job(result.rows[0]) : null;
  }
  async jobByRequest(idempotencyKey: string): Promise<AgentJob | null> {
    const result = await this.pool.query(
      "SELECT * FROM agent_jobs WHERE user_id=$1 AND idempotency_key=$2",
      [this.userId, idempotencyKey],
    );
    return result.rows[0] ? job(result.rows[0]) : null;
  }
  async listJobs(limit = 50): Promise<AgentJob[]> {
    return (
      await this.pool.query(
        "SELECT * FROM agent_jobs WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT $2",
        [this.userId, Math.max(1, Math.min(limit, 200))],
      )
    ).rows.map(job);
  }
  async listSessionJobs(sessionId: string): Promise<AgentJob[]> {
    return (
      await this.pool.query(
        "SELECT * FROM agent_jobs WHERE user_id=$1 AND session_id=$2 ORDER BY created_at DESC,id LIMIT 200",
        [this.userId, sessionId],
      )
    ).rows.map(job);
  }
  /** The worker must hold acquireRunLock while claiming and processing a job. */
  async claimNextJob(): Promise<AgentJob | null> {
    this.rootOnly();
    const result = await this.pool.query(`
      WITH next_job AS (
        SELECT j.id FROM agent_jobs j JOIN accounts a ON a.id=j.user_id
        WHERE j.status='queued' AND NOT j.cancel_requested AND NOT a.disabled
        ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1
      )
      UPDATE agent_jobs SET status='running',updated_at=now()
      WHERE id=(SELECT id FROM next_job) RETURNING *
    `);
    return result.rows[0] ? job(result.rows[0]) : null;
  }
  async finishJob(
    id: string,
    status: Extract<JobStatus, "completed" | "failed" | "cancelled">,
    result?: RunResult,
    error?: string,
  ): Promise<AgentJob | null> {
    this.rootOnly();
    const row = await this.pool.query(
      `UPDATE agent_jobs SET
         status=CASE WHEN cancel_requested THEN 'cancelled' ELSE $2 END,
         result=CASE WHEN cancel_requested THEN NULL ELSE $3::jsonb END,
         run_id=COALESCE($4,run_id), error=CASE WHEN cancel_requested THEN '任务已停止。' ELSE $5 END,
         updated_at=now()
       WHERE id=$1 AND status='running' RETURNING *`,
      [
        id,
        status,
        result ? JSON.stringify(result) : null,
        result?.runId ?? null,
        error?.slice(0, 500) ?? null,
      ],
    );
    return row.rows[0] ? job(row.rows[0]) : null;
  }
  async requestCancelJob(id: string): Promise<AgentJob | null> {
    const result = await this.pool.query(
      "UPDATE agent_jobs SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,cancel_requested=true,updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('queued','running') RETURNING *",
      [id, this.userId],
    );
    return result.rows[0] ? job(result.rows[0]) : this.getJob(id);
  }
  /** Call only after acquiring the global run lock; queued work remains durable. */
  async recoverJobs() {
    this.rootOnly();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "UPDATE agent_jobs SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END,error='服务重启，任务未能完成，请重新提交。',updated_at=now() WHERE status='running'",
      );
      await client.query(
        "UPDATE runs SET status='failed',error='服务重启，未完成的运行已中止。' WHERE status='running'",
      );
      await client.query("COMMIT");
      return result.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  /** A dedicated DB connection holds the lock until release, including across replicas. */
  async acquireRunLock(
    onLost?: () => void,
  ): Promise<(() => Promise<void>) | null> {
    const client = await this.pool.connect();
    let lost = false;
    const disconnected = () => {
      if (lost) return;
      lost = true;
      onLost?.();
    };
    client.on("error", disconnected);
    try {
      const r = await client.query(
        "SELECT pg_try_advisory_lock(713042602) AS locked",
      );
      if (!r.rows[0].locked) {
        client.removeListener("error", disconnected);
        client.release();
        return null;
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          if (!lost) await client.query("SELECT pg_advisory_unlock(713042602)");
        } catch {
          // Never put a client with an uncertain advisory-lock state back into the pool.
          lost = true;
        } finally {
          client.removeListener("error", disconnected);
          client.release(lost);
        }
      };
    } catch (e) {
      client.removeListener("error", disconnected);
      client.release(true);
      throw e;
    }
  }
}
