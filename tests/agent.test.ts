import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  runAgent,
  resolveModelEndpoint,
  type AgentStore,
} from "../server/agent";
import type {
  Memory,
  Message,
  ModelProfile,
  RunSummary,
  Usage,
} from "../server/types";
import { sampleInput } from "../src/lib/chart";

class FakeStore {
  profile: ModelProfile = {
    id: "model",
    name: "Test",
    baseUrl: "https://api.deepseek.com/v1",
    model: "test-model",
    enabled: true,
    inputPricePerMillion: 2,
    outputPricePerMillion: 4,
    currency: "CNY",
    dailyTokenLimit: 0,
    dailyCostLimit: 0,
  };
  messages: Message[] = [];
  memories: Memory[] = [];
  runs: RunSummary[] = [];
  usage: Usage[] = [];
  async getSession(id: string) {
    return {
      id,
      title: "test",
      birth: sampleInput,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  async getModel() {
    return this.profile;
  }
  async addMessage(sessionId: string, role: Message["role"], content: string) {
    const m = {
      id: randomUUID(),
      sessionId,
      role,
      content,
      createdAt: new Date().toISOString(),
    };
    this.messages.push(m);
    return m;
  }
  async listMessages() {
    return this.messages;
  }
  async createRun(sessionId: string, modelId: string) {
    const r: RunSummary = {
      id: randomUUID(),
      sessionId,
      modelId,
      status: "running",
      steps: 0,
      createdAt: new Date().toISOString(),
      events: [],
    };
    this.runs.push(r);
    return r;
  }
  async updateRun(id: string, patch: Partial<RunSummary>) {
    Object.assign(
      this.runs.find((r) => r.id === id)!,
      patch,
    );
    return this.runs.find((r) => r.id === id)!;
  }
  async dailyUsage() {
    return this.usage.reduce(
      (a, u) => ({
        ...a,
        inputTokens: a.inputTokens + u.inputTokens,
        outputTokens: a.outputTokens + u.outputTokens,
        totalTokens: a.totalTokens + u.totalTokens,
        estimatedCost: a.estimatedCost + u.estimatedCost,
      }),
      {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        currency: this.profile.currency,
      },
    );
  }
  async insertUsage(input: Omit<Usage, "id" | "createdAt">) {
    const u = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.usage.push(u);
    return u;
  }
  async updateUsage(id: string, patch: Partial<Usage>) {
    const u = this.usage.find((u) => u.id === id)!;
    Object.assign(u, patch);
    return u;
  }
  async listMemories() {
    return this.memories.filter((m) => m.status === "active");
  }
  async searchMemories() {
    return this.listMemories();
  }
  async addMemory(input: {
    content: string;
    sessionId?: string | null;
    status?: Memory["status"];
  }) {
    const m: Memory = {
      id: randomUUID(),
      sessionId: input.sessionId ?? null,
      content: input.content,
      status: input.status ?? "pending",
      hasEmbedding: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.memories.push(m);
    return m;
  }
  adapter() {
    return this as unknown as AgentStore;
  }
}
const answer = (
  content = "完成",
  usage: object | null = { prompt_tokens: 100, completion_tokens: 50 },
) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      ...(usage ? { usage } : {}),
    }),
    { status: 200 },
  );
const call = (name: string, args: object = {}, id = "call1") => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
const args = (s: FakeStore) => ({
  store: s.adapter(),
  sessionId: "session",
  modelId: "model",
  content: "请读取命盘，并记住我明确说过偏爱简短回答。",
  apiKey: "fake-test-key",
});

test("provider destinations are restricted and never permit credentials or metadata addresses", () => {
  assert.throws(() =>
    resolveModelEndpoint("http://169.254.169.254/latest/meta-data"),
  );
  assert.throws(() =>
    resolveModelEndpoint("https://secret@api.deepseek.com/v1"),
  );
  assert.equal(
    resolveModelEndpoint("https://api.deepseek.com/v1"),
    "https://api.deepseek.com/v1/chat/completions",
  );
});
test("agent executes chart and pending memory tools, resumes model, reconciles every usage row", async () => {
  const s = new FakeStore();
  let calls = 0;
  const payloads: any[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    assert.equal(s.usage.at(-1)?.status, "reserved");
    payloads.push(JSON.parse(String(init?.body)));
    calls++;
    if (calls === 1)
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                reasoning_content: "private transient reasoning",
                tool_calls: [
                  call("get_chart", { years: [2030, 2031, 2032, 2033, 2034] }),
                  call(
                    "propose_memory",
                    { content: "用户偏好简短回答" },
                    "call2",
                  ),
                ],
              },
            },
          ],
          usage: { prompt_tokens: 110, completion_tokens: 40 },
        }),
      );
    return answer();
  };
  const result = await runAgent({ ...args(s), fetcher });
  assert.equal(calls, 2);
  assert.equal(result.events.length, 2);
  assert.equal(result.memoryCandidates[0].status, "pending");
  assert.equal((await s.listMemories()).length, 0);
  assert.equal(result.usage.inputTokens, 210);
  assert.equal(result.usage.outputTokens, 90);
  assert.equal(s.usage.length, 2);
  assert.ok(
    s.usage.every(
      (u) => u.usageSource === "provider" && u.status === "completed",
    ),
  );
  assert.equal(s.runs[0].status, "completed");
  assert.equal(s.runs[0].events?.length, 2);
  const tool = payloads[1].messages.find(
    (m: any) => m.role === "tool" && m.tool_call_id === "call1",
  );
  assert.equal(JSON.parse(tool.content).palaces.length, 12);
  assert.deepEqual(
    JSON.parse(tool.content).timing.annualPeriods.map(
      (period: { year: number }) => period.year,
    ),
    [2030, 2031, 2032, 2033, 2034],
  );
  assert.equal(JSON.parse(tool.content).fiveElementsClass, "金四局");
  assert.ok(!JSON.stringify(s).includes("fake-test-key"));
  assert.ok(!JSON.stringify(s).includes("private transient reasoning"));
  assert.ok(!tool.content.includes(sampleInput.date));
});
test("chart tool rejects oversized year queries and lets the model recover", async () => {
  const s = new FakeStore();
  let calls = 0;
  await runAgent({
    ...args(s),
    fetcher: async (_url, init) => {
      if (++calls === 1)
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    call("get_chart", {
                      years: [2020, 2021, 2022, 2023, 2024, 2025],
                    }),
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          }),
        );
      const body = JSON.parse(String(init?.body));
      const result = body.messages.find(
        (message: { role: string }) => message.role === "tool",
      );
      assert.match(result.content, /1—5/);
      assert.ok(!result.content.includes(sampleInput.date));
      return answer();
    },
  });
  assert.equal(calls, 2);
});
test("initial model request already has requested timing even without a tool call", async () => {
  const s = new FakeStore();
  await runAgent({
    ...args(s),
    content:
      "查看流年：2030年、2031年、2032年、2033年、2034年。\n只聊工作变化。",
    fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const data = JSON.parse(body.messages[1].content).attachedChart;
      assert.equal(data.fiveElementsClass, "金四局");
      assert.equal(data.gender, "female");
      assert.deepEqual(
        data.timing.annualPeriods.map((p: { year: number }) => p.year),
        [2030, 2031, 2032, 2033, 2034],
      );
      assert.ok(!String(init?.body).includes(sampleInput.date));
      return answer("已结合大限和所选年份分析。");
    },
  });
  assert.equal(s.runs[0].steps, 1);
});

test("confirmed memory crosses conversations while unconfirmed proposals stay out of model context", async () => {
  const s = new FakeStore();
  await s.addMemory({ content: "用户喜欢简洁语言", status: "active" });
  await s.addMemory({ content: "尚未确认的内容", status: "pending" });
  await runAgent({
    ...args(s),
    fetcher: async (_url, init) => {
      const payload = String(init?.body);
      assert.ok(payload.includes("用户喜欢简洁语言"));
      assert.ok(!payload.includes("尚未确认的内容"));
      return answer();
    },
  });
});
test("token and cost budgets block before any provider request", async () => {
  for (const mode of ["tokens", "cost"]) {
    const s = new FakeStore();
    if (mode === "tokens") s.profile.dailyTokenLimit = 10;
    else s.profile.dailyCostLimit = 0.000001;
    let count = 0;
    await assert.rejects(
      runAgent({
        ...args(s),
        fetcher: async () => {
          count++;
          return answer();
        },
      }),
      /额度不足/,
    );
    assert.equal(count, 0);
    assert.equal(s.usage.length, 0);
    assert.equal(s.runs[0].status, "failed");
  }
});
test("missing usage and network interruption keep conservative visible reservations", async () => {
  const s = new FakeStore();
  await runAgent({
    ...args(s),
    fetcher: async () => answer("没有usage", null),
  });
  assert.equal(s.usage[0].usageSource, "estimate");
  assert.ok(s.usage[0].totalTokens > 1600);
  const failed = new FakeStore();
  await assert.rejects(
    runAgent({
      ...args(failed),
      fetcher: async () => {
        throw new Error("transport secret fake-test-key");
      },
    }),
    /连接失败/,
  );
  assert.equal(failed.usage[0].usageSource, "unknown");
  assert.ok(failed.usage[0].totalTokens > 1600);
  assert.ok(!JSON.stringify(failed).includes("fake-test-key"));
});
test("per-user tokens bound output and are rechecked before each tool step", async () => {
  const baseline = new FakeStore();
  await runAgent({
    ...args(baseline),
    fetcher: async () => answer("baseline", null),
  });
  const inputBound = baseline.usage[0].inputTokens;
  const limited = new FakeStore();
  let calls = 0;
  await runAgent({
    ...args(limited),
    userTokenBudget: async () => ({ limit: inputBound + 256, used: 0 }),
    fetcher: async (_url, init) => {
      calls++;
      assert.equal(JSON.parse(String(init?.body)).max_tokens, 256);
      assert.equal(limited.usage[0].totalTokens, inputBound + 256);
      return answer("limited", null);
    },
  });
  assert.equal(calls, 1);
  const tool = new FakeStore();
  let budgetReads = 0,
    modelCalls = 0;
  await assert.rejects(
    runAgent({
      ...args(tool),
      userTokenBudget: async () =>
        ++budgetReads === 1
          ? { limit: 100000, used: 0 }
          : { limit: 1, used: 1 },
      fetcher: async () => {
        modelCalls++;
        return new Response(
          JSON.stringify({
            choices: [{ message: { tool_calls: [call("get_chart")] } }],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          }),
        );
      },
    }),
    /今天的解读暂时/,
  );
  assert.equal(modelCalls, 1);
  assert.equal(budgetReads, 2);
  assert.equal(tool.usage.length, 1);
  await assert.rejects(
    runAgent({
      ...args(new FakeStore()),
      userTokenBudget: async () => ({ limit: 1, used: 0 }),
      fetcher: async () => {
        assert.fail("must not call the model");
        return answer();
      },
    }),
    /今天的解读暂时/,
  );
});
test("five-step cap stops repeated tool requests and each step remains in ledger", async () => {
  const s = new FakeStore();
  let n = 0;
  await assert.rejects(
    runAgent({
      ...args(s),
      fetcher: async () => {
        n++;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [call("search_memory", { query: "简短" })],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        );
      },
    }),
    /步骤上限/,
  );
  assert.equal(n, 5);
  assert.equal(s.usage.length, 5);
  assert.equal(s.runs[0].status, "failed");
});
test("unknown tools cannot execute outside the registry and malformed arguments are safe", async () => {
  const s = new FakeStore();
  let n = 0;
  const result = await runAgent({
    ...args(s),
    fetcher: async () => {
      n++;
      return n === 1
        ? new Response(
            JSON.stringify({
              choices: [
                {
                  message: { tool_calls: [call("shell", { cmd: "anything" })] },
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            }),
          )
        : answer();
    },
  });
  assert.equal(result.events[0].status, "error");
  assert.match(result.events[0].summary, /未获授权/);
});
test("cancellation aborts active fetch, preserves ledger and marks run cancelled", async () => {
  const s = new FakeStore();
  const controller = new AbortController();
  const promise = runAgent({
    ...args(s),
    signal: controller.signal,
    fetcher: async (_u, init) => {
      queueMicrotask(() => controller.abort());
      return await new Promise((_r, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        ),
      );
    },
  });
  await assert.rejects(promise, /已停止/);
  assert.equal(s.runs[0].status, "cancelled");
  assert.equal(s.usage[0].usageSource, "unknown");
});

test("cancellation at response arrival retains actual usage without saving an answer", async () => {
  const s = new FakeStore();
  const controller = new AbortController();
  await assert.rejects(
    runAgent({
      ...args(s),
      signal: controller.signal,
      fetcher: async () => {
        controller.abort();
        return answer();
      },
    }),
    /已停止/,
  );
  assert.equal(s.runs[0].status, "cancelled");
  assert.equal(s.messages.filter((m) => m.role === "assistant").length, 0);
  assert.equal(s.usage[0].totalTokens, 150);
  assert.equal(s.usage[0].usageSource, "provider");
});

test("engine tools execute on demand and every model continuation is metered", async () => {
  const s = new FakeStore();
  let count = 0;
  const result = await runAgent({
    ...args(s),
    content: "比较时间段，再核对命宫结构。",
    fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (++count === 1) {
        for (const name of [
          "get_horoscope",
          "get_chart_variant",
          "list_fortune_periods",
          "inspect_chart",
          "convert_calendar",
        ])
          assert.ok(body.tools.some((t: any) => t.function.name === name));
        const data = JSON.parse(body.messages[1].content).attachedChart;
        assert.equal(data.timing.annualPeriods.length, 0);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    call(
                      "get_horoscope",
                      { dates: ["2026-11-03"], scopes: ["monthly", "daily"] },
                      "date",
                    ),
                    call(
                      "list_fortune_periods",
                      { kind: "months", year: 2025 },
                      "months",
                    ),
                    call(
                      "inspect_chart",
                      { palace: "命宫", view: "relationships" },
                      "palace",
                    ),
                    call(
                      "convert_calendar",
                      {
                        calendar: "lunar",
                        date: "2025-06-16",
                        isLeapMonth: true,
                      },
                      "calendar",
                    ),
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 60 },
          }),
        );
      }
      if (count === 2)
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    call(
                      "get_chart_variant",
                      { astroType: "earth" },
                      "variant",
                    ),
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 200, completion_tokens: 30 },
          }),
        );
      const results = Object.fromEntries(
        body.messages
          .filter((m: any) => m.role === "tool")
          .map((m: any) => [m.tool_call_id, JSON.parse(m.content)]),
      );
      assert.equal(results.date.periods[0].layers.length, 2);
      assert.equal(results.months.periods.length, 14);
      assert.equal(results.palace.surrounded.length, 4);
      assert.equal(results.calendar.solar, "2025-08-09");
      assert.equal(results.variant.palaces.length, 12);
      assert.ok(!String(init?.body).includes(sampleInput.date));
      return answer("已按查询日期和命宫结构说明。");
    },
  });
  assert.equal(result.events.length, 5);
  assert.ok(result.events.every((e) => e.status === "ok"));
  assert.equal(s.usage.length, 3);
  assert.ok(s.usage.every((u) => u.status === "completed"));
});

test("invalid engine arguments produce a recoverable bounded error rather than fabricated data", async () => {
  const s = new FakeStore();
  let count = 0;
  await runAgent({
    ...args(s),
    fetcher: async (_url, init) => {
      if (++count === 1)
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    call("get_horoscope", {
                      dates: ["2026-02-30"],
                      scopes: ["daily"],
                    }),
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          }),
        );
      const body = JSON.parse(String(init?.body));
      const data = JSON.parse(
        body.messages.find((m: any) => m.role === "tool").content,
      );
      assert.match(data.error, /真实存在/);
      assert.ok(!data.error.includes(sampleInput.date));
      return answer();
    },
  });
  assert.equal(s.runs[0].events?.[0].status, "error");
});

test("a selected daily period reaches the first model request even if it never calls tools", async () => {
  const s = new FakeStore();
  await runAgent({
    ...args(s),
    content: "查看流日：2026-11-03。\n今天工作上的变化。",
    fetcher: async (_url, init) => {
      const data = JSON.parse(
        JSON.parse(String(init?.body)).messages[1].content,
      ).attachedChart;
      assert.equal(data.timing.annualPeriods.length, 0);
      assert.deepEqual(
        data.requestedData[0].data.periods[0].layers.map((l: any) => l.scope),
        ["yearly", "monthly", "daily"],
      );
      assert.equal(data.requestedData[0].data.periods[0].date, "2026-11-03");
      return answer();
    },
  });
  assert.equal(s.runs[0].steps, 1);
});
