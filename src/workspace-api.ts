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
}
export type ModelDraft = Omit<ModelProfile, "id">;
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
export interface Health {
  ok: boolean;
  needsSetup: boolean;
  authenticated: boolean;
  version: string;
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
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method || "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
      headers:
        options.body === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    if (
      options.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw new DOMException("请求已停止。", "AbortError");
    throw new WorkspaceError("无法连接本地服务。请确认后端与数据库已经启动。");
  }
  if (
    !(response.headers.get("content-type") || "").includes("application/json")
  ) {
    throw new WorkspaceError(
      response.status === 401
        ? "登录已过期，请重新登录。"
        : "当前页面没有可用的工作台 API。请启动本地完整版本。",
      response.status,
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new WorkspaceError(
      "服务返回的数据无法读取，请重试。",
      response.status,
    );
  }
  if (!response.ok) {
    const payload = data as {
      error?: string | { message?: string };
      message?: string;
    };
    const detail =
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message || payload.message;
    throw new WorkspaceError(
      response.status === 401
        ? "密码不正确或登录已过期，请重新登录。"
        : typeof detail === "string"
          ? detail.slice(0, 500)
          : `请求失败（HTTP ${response.status}）。`,
      response.status,
    );
  }
  return data as T;
}
const idPath = (value: string) => encodeURIComponent(value);
export const workspaceApi = {
  health: (signal?: AbortSignal) => request<Health>("/health", { signal }),
  setup: (password: string) =>
    request<{ ok: true }>("/auth/setup", {
      method: "POST",
      body: { password },
    }),
  login: (password: string) =>
    request<{ ok: true }>("/auth/login", {
      method: "POST",
      body: { password },
    }),
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
    }),
  cancelRun: (id: string) =>
    request<{ ok: true }>(`/runs/${idPath(id)}/cancel`, { method: "POST" }),
  exportData: () => request<Record<string, unknown>>("/export"),
};
