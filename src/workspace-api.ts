import type { ChartInput } from "./lib/chart";

export type Currency = "USD" | "CNY";
export type UsageSource = "provider" | "estimate" | "unknown";
export interface ModelProfile {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  currency: Currency;
  dailyTokenLimit: number;
  dailyCostLimit: number;
  hosted?: boolean;
}
export type ModelDraft = Omit<ModelProfile, "id" | "hosted">;
export interface Session {
  id: string;
  title: string;
  birth: ChartInput | null;
  createdAt: string;
  updatedAt: string;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}
export interface Memory {
  id: string;
  sessionId: string | null;
  content: string;
  status: "pending" | "active";
  createdAt: string;
  updatedAt: string;
  hasEmbedding: boolean;
}
export interface RunSummary {
  id: string;
  sessionId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  steps: number;
  createdAt: string;
  error?: string;
}
export interface SessionDetail {
  session: Session;
  messages: Message[];
  runs: RunSummary[];
  jobs?: AgentJob[];
}
export interface ToolEvent {
  tool: string;
  summary: string;
  status: "ok" | "error";
}
export interface Usage {
  id: string;
  runId: string;
  sessionId: string | null;
  modelId: string;
  modelName: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  currency: Currency;
  usageSource: UsageSource;
  status: string;
  createdAt: string;
}
export interface RunResult {
  runId: string;
  message: Message;
  events: ToolEvent[];
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCost: number | null;
    currency: Currency;
    usageSource: UsageSource;
  };
  memoryCandidates: Memory[];
}
export interface Dashboard {
  sessions: number;
  memories: number;
  runs: number;
  today: { inputTokens: number; outputTokens: number; totalTokens: number };
  costs: Array<{ currency: Currency; amount: number }>;
  models: ModelProfile[];
  usage: Usage[];
  embedding: { provider: string; configured: boolean; dimensions: number };
}
export interface Account {
  id: string;
  username: string;
  role: "admin" | "user";
  disabled?: boolean;
  createdAt?: string;
}
export interface SiteSettings {
  registrationOpen: boolean;
  dailyRunLimit: number;
}
export interface AgentJob {
  id: string;
  sessionId: string;
  modelId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  runId?: string | null;
  error?: string | null;
  result?: RunResult | null;
  cancelRequested: boolean;
  createdAt: string;
}
export interface AccountUsage {
  user: Account;
  dailyRunLimit: number;
  usedToday: number;
}
export interface Health {
  ok: boolean;
  needsSetup: boolean;
  authenticated: boolean;
  version: string;
  mode?: "public" | "local";
  user?: Account | null;
  registrationOpen?: boolean;
  dailyRunLimit?: number;
  requiresSetupToken?: boolean;
  hostedModels?: boolean;
}
export class WorkspaceError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "WorkspaceError";
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 20000);
  try {
    let response: Response;
    try {
      response = await fetch(`/api${path}`, {
        method: options.method || "GET",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        headers:
          options.body === undefined
            ? { Accept: "application/json" }
            : {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      if (options.signal?.aborted)
        throw new DOMException("请求已停止。", "AbortError");
      if (timedOut)
        throw new WorkspaceError("请求超时，请刷新查看状态后重试。");
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new WorkspaceError("无法连接服务，请检查网络后重试。");
    }
    if (
      !(response.headers.get("content-type") || "").includes("application/json")
    ) {
      throw new WorkspaceError(
        response.status === 401
          ? "登录已过期，请重新登录。"
          : "当前页面没有可用的工作台 API。请打开完整部署的站点，或启动本地版本。",
        response.status,
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (options.signal?.aborted)
        throw new DOMException("请求已停止。", "AbortError");
      throw new WorkspaceError(
        timedOut
          ? "请求超时，请刷新查看状态后重试。"
          : "服务返回的数据无法读取，请重试。",
        response.status,
      );
    }
    if (!response.ok) {
      const payload = (data || {}) as {
        error?: string | { message?: string };
        message?: string;
      };
      const detail =
        typeof payload.error === "string"
          ? payload.error
          : payload.error?.message || payload.message;
      throw new WorkspaceError(
        response.status === 401
          ? "账号、密码不正确或登录已过期，请重新登录。"
          : typeof detail === "string"
            ? detail.slice(0, 500)
            : `请求失败（HTTP ${response.status}）。`,
        response.status,
      );
    }
    return data as T;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

const idPath = (value: string) => encodeURIComponent(value);
export const workspaceApi = {
  health: (signal?: AbortSignal) => request<Health>("/health", { signal }),
  setup: (
    password: string,
    options?: { username: string; setupToken: string },
  ) =>
    request<{ ok: true }>("/auth/setup", {
      method: "POST",
      body: { password, ...options },
    }),
  login: (password: string, username?: string) =>
    request<{ ok: true }>("/auth/login", {
      method: "POST",
      body: { password, ...(username ? { username } : {}) },
    }),
  register: (username: string, password: string) =>
    request<{ ok: true }>("/auth/register", {
      method: "POST",
      body: { username, password },
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/auth/password", {
      method: "POST",
      body: { currentPassword, newPassword },
    }),
  account: () => request<AccountUsage>("/account"),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  sessions: () => request<{ sessions: Session[] }>("/sessions"),
  createSession: (body: { title?: string; birth?: ChartInput }) =>
    request<{ session: Session }>("/sessions", { method: "POST", body }),
  session: (id: string, signal?: AbortSignal) =>
    request<SessionDetail>(`/sessions/${idPath(id)}`, { signal }),
  deleteSession: (id: string) =>
    request<{ ok: true }>(`/sessions/${idPath(id)}`, { method: "DELETE" }),
  models: () => request<{ models: ModelProfile[] }>("/models"),
  createModel: (body: ModelDraft) =>
    request<{ model: ModelProfile }>("/models", { method: "POST", body }),
  updateModel: (id: string, body: ModelDraft) =>
    request<{ model: ModelProfile }>(`/models/${idPath(id)}`, {
      method: "PUT",
      body,
    }),
  deleteModel: (id: string) =>
    request<{ model?: ModelProfile; ok?: true }>(`/models/${idPath(id)}`, {
      method: "DELETE",
    }),
  memories: () => request<{ memories: Memory[] }>("/memories"),
  createMemory: (body: { content: string; sessionId?: string }) =>
    request<{ memory: Memory }>("/memories", { method: "POST", body }),
  updateMemory: (
    id: string,
    body: { content?: string; status?: "pending" | "active" },
  ) =>
    request<{ memory: Memory }>(`/memories/${idPath(id)}`, {
      method: "PATCH",
      body,
    }),
  deleteMemory: (id: string) =>
    request<{ ok: true }>(`/memories/${idPath(id)}`, { method: "DELETE" }),
  reindex: () =>
    request<{ updated: number; failed: number }>("/memories/reindex", {
      method: "POST",
    }),
  usage: () => request<Dashboard>("/usage"),
  run: (
    id: string,
    body: { content: string; modelId: string; apiKey: string },
    signal: AbortSignal,
  ) =>
    request<RunResult>(`/sessions/${idPath(id)}/runs`, {
      method: "POST",
      body,
      signal,
      timeoutMs: 140000,
    }),
  cancelRun: (id: string) =>
    request<{ ok: true }>(`/runs/${idPath(id)}/cancel`, { method: "POST" }),
  enqueue: (
    id: string,
    body: { content: string; modelId: string; idempotencyKey: string },
    signal?: AbortSignal,
  ) =>
    request<{ job: AgentJob }>(`/sessions/${idPath(id)}/jobs`, {
      method: "POST",
      body,
      signal,
    }),
  job: (id: string, signal?: AbortSignal) =>
    request<{ job: AgentJob }>(`/jobs/${idPath(id)}`, { signal }),
  activeJobs: () => request<{ jobs: AgentJob[] }>("/jobs?active=1"),
  cancelJob: (id: string) =>
    request<{ job?: AgentJob; ok?: true }>(`/jobs/${idPath(id)}/cancel`, {
      method: "POST",
    }),
  saveSecret: (id: string, apiKey: string) =>
    request<{ ok: true }>(`/models/${idPath(id)}/secret`, {
      method: "POST",
      body: { apiKey },
    }),
  clearSecret: (id: string) =>
    request<{ ok: true }>(`/models/${idPath(id)}/secret`, { method: "DELETE" }),
  siteSettings: () => request<{ settings: SiteSettings }>("/admin/settings"),
  saveSettings: (settings: SiteSettings) =>
    request<{ settings: SiteSettings }>("/admin/settings", {
      method: "PUT",
      body: settings,
    }),
  users: () => request<{ users: Account[] }>("/admin/users"),
  updateUser: (id: string, disabled: boolean) =>
    request<{ user: Account }>(`/admin/users/${idPath(id)}`, {
      method: "PATCH",
      body: { disabled },
    }),
  resetUserPassword: (id: string, password: string) =>
    request<{ ok: true }>(`/admin/users/${idPath(id)}/password`, {
      method: "POST",
      body: { password },
    }),
  adminUsage: () => request<Dashboard>("/admin/usage"),
  exportData: () => request<Record<string, unknown>>("/export"),
};
