import type { ChartInput } from "../src/lib/chart";

export type Currency = "USD" | "CNY";
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
export interface Session {
  id: string;
  title: string;
  birth: ChartInput | null;
  createdAt: string;
  updatedAt: string;
}
export interface Message {
  id: string;
  sessionId: string;
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
export type RunStatus = "running" | "completed" | "failed" | "cancelled";
export interface RunSummary {
  id: string;
  sessionId: string;
  modelId: string;
  status: RunStatus;
  steps: number;
  createdAt: string;
  error?: string;
  events?: ToolEvent[];
}
export interface Usage {
  id: string;
  runId: string;
  sessionId: string | null;
  modelId: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  currency: Currency;
  usageSource: "provider" | "estimate" | "unknown";
  status: string;
  createdAt: string;
}
export interface ToolEvent {
  tool: string;
  summary: string;
  status: "ok" | "error";
}
export interface RunResult {
  runId: string;
  message: Message;
  events: ToolEvent[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    currency: Currency;
    usageSource: Usage["usageSource"];
  };
  memoryCandidates: Memory[];
}
export interface DailyUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  currency: Currency;
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
