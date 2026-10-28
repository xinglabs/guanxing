import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import pg from "pg";
import { Store } from "../server/store";
import { createApiServer } from "../server/index";
import { sampleInput } from "../src/lib/chart";

test(
  "full HTTP Agent flow persists tools, confirmed memory and usage without retaining Key",
  {
    skip: !process.env.TEST_DATABASE_URL,
    timeout: 30000,
  },
  async (t) => {
    const admin = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    const name = "guanxing_flow_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = "/" + name;
    const store = new Store(url.toString());
    await store.migrate();
    const transientKey = "not-a-real-key-" + randomUUID();
    const requests: any[] = [];
    const provider = createServer(async (req, res) => {
      assert.equal(req.headers.authorization, `Bearer ${transientKey}`);
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(part);
      const data = JSON.parse(Buffer.concat(parts).toString());
      requests.push(data);
      const message =
        requests.length === 1
          ? {
              content: null,
              tool_calls: [
                {
                  id: "chart",
                  type: "function",
                  function: { name: "get_chart", arguments: "{}" },
                },
                {
                  id: "memory",
                  type: "function",
                  function: {
                    name: "propose_memory",
                    arguments: JSON.stringify({
                      content: "用户明确偏好简短回答",
                    }),
                  },
                },
              ],
            }
          : { content: "这是测试服务的回复，不是实际模型解读。" };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message }],
          usage: { prompt_tokens: 120, completion_tokens: 30 },
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const modelPort = (provider.address() as { port: number }).port;
    const server = createApiServer({ store });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    t.after(async () => {
      server.closeAllConnections();
      provider.closeAllConnections();
      await Promise.all([
        new Promise<void>((resolve) => server.close(() => resolve())),
        new Promise<void>((resolve) => provider.close(() => resolve())),
      ]);
      await store.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    });
    let cookie = "";
    async function api(path: string, method = "GET", body?: object) {
      const response = await fetch(base + "/api" + path, {
        method,
        headers: {
          Origin: base,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.headers.get("set-cookie"))
        cookie = response.headers.get("set-cookie")!.split(";")[0];
      const data = (await response.json()) as any;
      assert.ok(response.ok, JSON.stringify(data));
      return data;
    }
    await api("/auth/setup", "POST", {
      password: "disposable-integration-password",
    });
    const { model } = await api("/models", "POST", {
      name: "Test provider",
      baseUrl: `http://127.0.0.1:${modelPort}/v1`,
      model: "test-only",
      enabled: true,
      inputPricePerMillion: 2,
      outputPricePerMillion: 4,
      currency: "CNY",
      dailyTokenLimit: 100000,
      dailyCostLimit: 10,
    });
    const { session } = await api("/sessions", "POST", {
      title: "测试排盘",
      birth: sampleInput,
    });
    const run = await api(`/sessions/${session.id}/runs`, "POST", {
      content: "请读取命盘，并记住我明确偏好简短回答。",
      modelId: model.id,
      apiKey: transientKey,
    });
    assert.equal(run.events.length, 2);
    assert.equal(run.memoryCandidates[0].status, "pending");
    assert.equal(run.usage.inputTokens, 240);
    const tool = requests[1].messages.find(
      (m: any) => m.tool_call_id === "chart",
    );
    assert.equal(JSON.parse(tool.content).palaces.length, 12);
    assert.ok(!tool.content.includes(sampleInput.date));
    assert.equal(
      (await api(`/sessions/${session.id}`)).runs[0].events.length,
      2,
    );
    const memoryId = run.memoryCandidates[0].id;
    await api(`/memories/${memoryId}`, "PATCH", { status: "active" });
    const { session: next } = await api("/sessions", "POST", {
      title: "新的对话",
    });
    await api(`/sessions/${next.id}/runs`, "POST", {
      content: "我有什么表达偏好？",
      modelId: model.id,
      apiKey: transientKey,
    });
    assert.ok(
      JSON.stringify(requests[2].messages).includes("用户明确偏好简短回答"),
    );
    const dashboard = await api("/usage");
    assert.equal(dashboard.usage.length, 3);
    assert.equal(dashboard.today.totalTokens, 450);
    assert.equal(dashboard.embedding.configured, false);
    const exported = JSON.stringify(await api("/export"));
    assert.ok(!exported.includes(transientKey));
    assert.ok(!exported.includes("disposable-integration-password"));
    await api(`/sessions/${session.id}`, "DELETE");
    assert.equal((await api("/usage")).today.totalTokens, 450);
  },
);
