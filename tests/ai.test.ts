import assert from "node:assert/strict";
import test from "node:test";
import { createChart, sampleInput } from "../src/lib/chart";
import {
  chartForAI,
  readChart,
  resolveEndpoint,
  type AIConfig,
} from "../src/lib/ai";

const chart = createChart({ ...sampleInput, name: "PRIVATE_NAME_123" });
const config: AIConfig = {
  baseUrl: "https://model.example/v1",
  model: "example-model",
  apiKey: "test-only-key",
};

// Tests execute sequentially because they replace global fetch.
test("endpoint requires HTTPS except for explicit loopback development", () => {
  assert.equal(
    resolveEndpoint("https://model.example/v1/"),
    "https://model.example/v1/chat/completions",
  );
  assert.equal(
    resolveEndpoint("https://model.example/v1/chat/completions"),
    "https://model.example/v1/chat/completions",
  );
  assert.equal(
    resolveEndpoint("http://localhost:1234/v1"),
    "http://localhost:1234/v1/chat/completions",
  );
  for (const url of [
    "http://model.example",
    "https://user:pass@model.example/v1",
    "https://model.example/v1?key=secret",
    "https://model.example/v1#secret",
    "file:///tmp/model",
  ])
    assert.throws(() => resolveEndpoint(url));
});

test("AI data allowlist omits name, birthday, age and unrelated chart fields", () => {
  const data = chartForAI(chart);
  assert.equal(data.palaces.length, 12);
  assert.deepEqual(Object.keys(data), ["palaces"]);
  const serialized = JSON.stringify(data);
  for (const value of [
    "PRIVATE_NAME_123",
    "1995",
    "birthInfo",
    "lunarInfo",
    "currentAge",
  ])
    assert.ok(!serialized.includes(value));
});

test("successful request sends only chart allowlist and question, and returns content", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, options?: RequestInit) => {
      assert.equal(url, "https://model.example/v1/chat/completions");
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.redirect, "error");
      assert.equal(options?.referrerPolicy, "no-referrer");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.model, config.model);
      assert.equal(body.stream, false);
      assert.ok(!String(options?.body).includes("PRIVATE_NAME_123"));
      assert.ok(!String(options?.body).includes(sampleInput.date));
      assert.equal(
        JSON.parse(body.messages[1].content).question,
        "我该如何看待工作方式？",
      );
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: "  根据官禄宫，可以观察工作习惯。  " } },
          ],
        }),
        { status: 200 },
      );
    },
  );
  assert.equal(
    await readChart(chart, config, "我该如何看待工作方式？"),
    "根据官禄宫，可以观察工作习惯。",
  );
});

test("non-200 error body is never exposed to user", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("sensitive-debug-body test-only-key", { status: 401 }),
  );
  await assert.rejects(
    readChart(chart, config, "整体解读"),
    (error) =>
      error instanceof Error &&
      error.message.includes("拒绝") &&
      !error.message.includes("test-only-key") &&
      !error.message.includes("sensitive"),
  );
});

test("rate limiting and malformed model payloads produce useful safe errors", async (t) => {
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("", { status: 429 }),
  );
  await assert.rejects(readChart(chart, config, "整体解读"), /限流或额度不足/);
  mock.mock.mockImplementation(async () => new Response("not json"));
  await assert.rejects(readChart(chart, config, "整体解读"), /无法读取/);
  mock.mock.mockImplementation(
    async () => new Response(JSON.stringify({ choices: [] })),
  );
  await assert.rejects(
    readChart(chart, config, "整体解读"),
    /没有返回解读文字/,
  );
});

test("timeout aborts request without leaking transport error", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    (_url: string | URL | Request, options?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  await assert.rejects(
    readChart(chart, { ...config, timeoutMs: 10 }, "整体解读"),
    /超时/,
  );
});

test("user cancellation aborts an in-flight request", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    (_url: string | URL | Request, options?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  const controller = new AbortController();
  const promise = readChart(chart, config, "整体解读", controller.signal);
  controller.abort();
  await assert.rejects(promise, /已停止/);
});

test("browser network errors do not expose provider URLs or secrets", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("secret transport URL");
  });
  await assert.rejects(
    readChart(chart, config, "整体解读"),
    (error) =>
      error instanceof Error &&
      error.message.includes("跨域") &&
      !error.message.includes("secret"),
  );
});

test("invalid questions and empty credentials fail before network", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("should not fetch");
  });
  await assert.rejects(
    readChart(chart, { ...config, apiKey: "" }, "整体解读"),
    /API Key/,
  );
  await assert.rejects(readChart(chart, config, ""), /问题/);
  await assert.rejects(readChart(chart, config, "x".repeat(1001)), /问题/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readChart(chart, config, "整体解读", controller.signal),
    /已停止/,
  );
  assert.equal(mock.mock.callCount(), 0);
});
