import type { RunResult } from "./types";

export interface Account {
  id: string;
  username: string;
  role: "admin" | "user";
  disabled: boolean;
  createdAt: string;
}

export interface AccountCredentials extends Account {
  passwordHash: string;
}

export interface SiteSettings {
  registrationOpen: boolean;
  dailyRunLimit: number;
}

export type JobStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled";

export interface AgentJob {
  id: string;
  userId: string;
  sessionId: string;
  modelId: string;
  content: string;
  idempotencyKey: string;
  status: JobStatus;
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
  runId?: string;
  error?: string;
  result?: RunResult;
}

export class StoreError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "StoreError";
  }
}
