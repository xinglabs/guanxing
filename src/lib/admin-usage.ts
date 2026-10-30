export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  unverifiedCalls: number;
  costs: Array<{ currency: "CNY" | "USD"; amount: number }>;
}

export interface AdminUsageReport {
  date: string;
  timezone: string;
  daily: UsageTotals;
  allTime: UsageTotals;
  users: Array<
    UsageTotals & {
      userId: string;
      username: string;
      role: "admin" | "user";
      disabled: boolean;
      requests: number;
    }
  >;
}
