import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store";
import type { ModelProfile, RunResult } from "./types";
import { runAgent } from "./agent";
import { embedText, embeddingStatus } from "./embedding";

export { hashPassword, verifyPassword } from "./http";
import {
  COOKIE,
  SESSION_MS,
  HttpError,
  fail,
  cookieToken,
  reply,
  body,
  string,
  birthInput,
  modelInput,
  digest,
  hashPassword,
  verifyPassword,
} from "./http";

export interface ServerOptions {
  store: Store;
  runner?: typeof runAgent;
  embed?: typeof embedText;
  embeddingInfo?: typeof embeddingStatus;
  allowedOrigins?: string[];
  secureCookies?: boolean;
  staticDir?: string;
}

export function createApiServer(options: ServerOptions) {
  const { store } = options,
    runner = options.runner ?? runAgent,
    embed = options.embed ?? embedText,
    embeddingInfo = options.embeddingInfo ?? embeddingStatus;
  const staticDir = resolve(
    options.staticDir ?? fileURLToPath(new URL("../dist", import.meta.url)),
  );
  const configuredOrigins =
    options.allowedOrigins ??
    (process.env.APP_ORIGIN?.split(",")
      .map((v) => v.trim())
      .filter(Boolean) ||
      []);
  const attempts = new Map<string, { count: number; reset: number }>();
  const active = new Map<string, AbortController>();
  let shuttingDown = false;
  function origins(req: IncomingMessage) {
    return [
      ...configuredOrigins,
      `http://localhost:${req.socket.localPort}`,
      `http://127.0.0.1:${req.socket.localPort}`,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ];
  }
  function checkHost(req: IncomingMessage) {
    const host = req.headers.host?.toLowerCase();
    if (
      !host ||
      !origins(req).some((origin) => {
        try {
          return new URL(origin).host.toLowerCase() === host;
        } catch {
          return false;
        }
      })
    )
      fail(403, "此主机未获准访问。请配置 APP_ORIGIN。");
  }
  function checkOrigin(req: IncomingMessage) {
    if (
      !req.headers.origin ||
      !origins(req).includes(req.headers.origin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      fail(403, "请求来源不被允许。");
  }
  function rateLimit(req: IncomingMessage) {
    const now = Date.now();
    const key = req.socket.remoteAddress || "unknown";
    let entry = attempts.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + 10 * 60 * 1000 };
      attempts.set(key, entry);
    }
    if (entry.count >= 5) fail(429, "登录尝试过多，请在 10 分钟后重试。");
    entry.count++;
    if (attempts.size > 1000) {
      for (const [k, v] of attempts) if (v.reset <= now) attempts.delete(k);
      while (attempts.size > 1000)
        attempts.delete(attempts.keys().next().value!);
    }
  }
  async function authenticated(req: IncomingMessage) {
    const token = cookieToken(req);
    return token
      ? (await store.authUser(digest(token)))?.id === "owner"
      : false;
  }
  async function signIn(req: IncomingMessage, res: ServerResponse) {
    const token = randomBytes(32).toString("base64url");
    await store.addAuthSession(
      digest(token),
      new Date(Date.now() + SESSION_MS),
    );
    const secure =
      options.secureCookies ??
      (req.headers.origin?.startsWith("https:") || false);
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? "; Secure" : ""}`,
    );
  }
  async function mutateLock<T>(action: () => Promise<T>) {
    const release = await store.acquireRunLock();
    if (!release) fail(409, "有任务正在运行，请停止或等待完成后再修改。");
    try {
      return await action();
    } finally {
      await release();
    }
  }
  async function embedMemory(id: string, content: string) {
    try {
      const vector = await embed(content);
      if (vector) await store.setMemoryEmbedding(id, vector, content);
    } catch {
      /* Memory remains saved, with no vector; reindex can retry. */
    }
  }
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    try {
      checkHost(req);
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const path = url.pathname;
      const method = req.method || "GET";
      if (path.startsWith("/api/")) {
        if (shuttingDown) fail(503, "服务正在停止。");
        if (!["GET", "HEAD"].includes(method)) checkOrigin(req);
        if (path === "/api/health" && method === "GET")
          return reply(res, 200, {
            ok: true,
            needsSetup: !(await store.hasOwner()),
            authenticated: await authenticated(req),
            version: "2.0.0",
          });
        if (
          (path === "/api/auth/setup" || path === "/api/auth/login") &&
          method === "POST"
        ) {
          rateLimit(req);
          const data = await body(req);
          const password = string(
            data.password,
            "密码",
            path.endsWith("setup") ? 12 : 1,
            1024,
          );
          if (path.endsWith("setup")) {
            const hash = await hashPassword(password);
            if (!(await store.setupOwner(hash)))
              fail(409, "管理员已经初始化，请登录。");
          } else if (
            !(await verifyPassword(password, await store.ownerPassword()))
          )
            fail(401, "密码不正确。");
          await signIn(req, res);
          attempts.delete(req.socket.remoteAddress || "unknown");
          return reply(res, 200, { ok: true });
        }
        if (!(await authenticated(req))) fail(401, "请先登录本地工作台。");
        if (path === "/api/auth/logout" && method === "POST") {
          const token = cookieToken(req);
          if (token) await store.deleteAuthSession(digest(token));
          res.setHeader(
            "Set-Cookie",
            `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
          );
          return reply(res, 200, { ok: true });
        }
        if (path === "/api/sessions" && method === "GET")
          return reply(res, 200, { sessions: await store.listSessions() });
        if (path === "/api/sessions" && method === "POST") {
          const data = await body(req);
          return reply(res, 201, {
            session: await store.createSession({
              title:
                data.title === undefined
                  ? undefined
                  : string(data.title, "对话标题", 1, 120),
              birth: birthInput(data.birth),
            }),
          });
        }
        let match = path.match(/^\/api\/sessions\/([^/]+)$/);
        if (match && method === "GET") {
          const session = await store.getSession(match[1]);
          if (!session) fail(404, "对话不存在。");
          return reply(res, 200, {
            session,
            messages: await store.listMessages(match[1]),
            runs: await store.listRuns(match[1]),
          });
        }
        if (match && method === "DELETE") {
          await mutateLock(async () => {
            if (!(await store.deleteSession(match![1])))
              fail(404, "对话不存在。");
          });
          return reply(res, 200, { ok: true });
        }
        if (path === "/api/models" && method === "GET")
          return reply(res, 200, { models: await store.listModels() });
        if (path === "/api/models" && method === "POST") {
          const input = modelInput(await body(req));
          return reply(res, 201, {
            model: await mutateLock(() => store.saveModel(input)),
          });
        }
        match = path.match(/^\/api\/models\/([^/]+)$/);
        if (match && method === "PUT") {
          const input = modelInput(await body(req));
          const id = match[1];
          return reply(res, 200, {
            model: await mutateLock(async () => {
              if (!(await store.getModel(id))) fail(404, "模型配置不存在。");
              try {
                return await store.saveModel(input, id);
              } catch {
                fail(400, "有用量记录的模型不能修改计价币种，请新建配置。");
              }
            }),
          });
        }
        if (match && method === "DELETE") {
          const id = match[1];
          await mutateLock(async () => {
            if (!(await store.deleteModel(id))) fail(404, "模型配置不存在。");
          });
          return reply(res, 200, { ok: true });
        }
        if (path === "/api/memories" && method === "GET")
          return reply(res, 200, { memories: await store.listMemories() });
        if (path === "/api/memories" && method === "POST") {
          const data = await body(req);
          const content = string(data.content, "记忆", 1, 4000);
          const sessionId =
            data.sessionId == null
              ? null
              : string(data.sessionId, "对话 ID", 1, 80);
          if (sessionId && !(await store.getSession(sessionId)))
            fail(404, "对话不存在。");
          const memory = await store.addMemory({
            content,
            sessionId,
            status: "active",
          });
          await embedMemory(memory.id, memory.content);
          return reply(res, 201, { memory: await store.getMemory(memory.id) });
        }
        if (path === "/api/memories/reindex" && method === "POST") {
          if (!embeddingInfo().configured)
            fail(400, "尚未配置向量服务，当前使用文本与近期记忆。");
          const items = await store.listMemories({
            status: "active",
            limit: 50,
          });
          let updated = 0,
            failed = 0;
          for (const item of items) {
            if (res.destroyed) break;
            try {
              const vector = await embed(item.content);
              if (vector) {
                await store.setMemoryEmbedding(item.id, vector, item.content);
                updated++;
              } else failed++;
            } catch {
              failed++;
            }
          }
          return reply(res, 200, { updated, failed });
        }
        match = path.match(/^\/api\/memories\/([^/]+)$/);
        if (match && method === "PATCH") {
          const data = await body(req);
          const patch: { content?: string; status?: "pending" | "active" } = {};
          if (data.content !== undefined)
            patch.content = string(data.content, "记忆", 1, 4000);
          if (data.status !== undefined) {
            if (data.status !== "pending" && data.status !== "active")
              fail(400, "记忆状态不正确。");
            patch.status = data.status;
          }
          if (!Object.keys(patch).length) fail(400, "没有要更新的内容。");
          const memory = await store.updateMemory(match[1], patch);
          if (!memory) fail(404, "记忆不存在。");
          if (memory.status === "active")
            await embedMemory(memory.id, memory.content);
          return reply(res, 200, { memory: await store.getMemory(memory.id) });
        }
        if (match && method === "DELETE") {
          if (!(await store.deleteMemory(match[1]))) fail(404, "记忆不存在。");
          return reply(res, 200, { ok: true });
        }
        if (path === "/api/usage" && method === "GET")
          return reply(res, 200, {
            ...(await store.dashboard()),
            embedding: embeddingInfo(),
          });
        if (path === "/api/export" && method === "GET")
          return reply(res, 200, await store.exportData());
        match = path.match(/^\/api\/sessions\/([^/]+)\/runs$/);
        if (match && method === "POST") {
          const data = await body(req);
          const content = string(data.content, "问题", 1, 12000);
          const modelId = string(data.modelId, "模型 ID", 1, 80);
          const apiKey = string(data.apiKey ?? "", "API Key", 0, 2048);
          if (/[\r\n]/.test(apiKey)) fail(400, "API Key 格式不正确。");
          const sessionId = match[1];
          if (!(await store.getSession(sessionId))) fail(404, "对话不存在。");
          const release = await store.acquireRunLock();
          if (!release) fail(409, "已有任务正在运行，请稍后重试。");
          const controller = new AbortController();
          const activeId = randomBytes(12).toString("hex");
          active.set(activeId, controller);
          const disconnected = () => {
            if (!res.writableEnded) controller.abort();
          };
          req.once("aborted", disconnected);
          res.once("close", disconnected);
          const timeout = setTimeout(() => controller.abort(), 125000);
          let result: RunResult;
          try {
            const model = await store.getModel(modelId);
            if (!model?.enabled) fail(400, "请选择已启用的模型。");
            const used = await store.dailyUsage(modelId);
            if (
              (model.dailyTokenLimit > 0 &&
                used.totalTokens >= model.dailyTokenLimit) ||
              (model.dailyCostLimit > 0 &&
                used.estimatedCost >= model.dailyCostLimit)
            )
              fail(429, "该模型今日额度已用完。");
            result = await runner({
              store,
              sessionId,
              content,
              modelId,
              apiKey,
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeout);
            active.delete(activeId);
            req.removeListener("aborted", disconnected);
            res.removeListener("close", disconnected);
            await release();
          }
          return reply(res, 200, result);
        }
        return fail(404, "接口不存在。");
      }
      if (method !== "GET" && method !== "HEAD")
        fail(405, "此请求方法不受支持。");
      let decoded: string;
      try {
        decoded = decodeURIComponent(path);
      } catch {
        return fail(400, "路径格式不正确。");
      }
      if (
        decoded.includes("\0") ||
        decoded.includes("\\") ||
        decoded.split("/").includes("..")
      )
        fail(400, "路径不被允许。");
      let file = resolve(staticDir, "." + decoded);
      if (file !== staticDir && !file.startsWith(staticDir + sep))
        fail(403, "路径不被允许。");
      try {
        if ((await stat(file)).isDirectory())
          file = resolve(file, "index.html");
        await stat(file);
      } catch {
        if (extname(decoded)) return fail(404, "文件不存在。");
        file = resolve(staticDir, "index.html");
      }
      let bytes: Buffer;
      try {
        bytes = await readFile(file);
      } catch {
        return fail(404, "前端尚未构建，请执行 npm run build。");
      }
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".webp": "image/webp",
        ".woff2": "font/woff2",
        ".ico": "image/x-icon",
      };
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        "Cache-Control":
          extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
      });
      res.end(method === "HEAD" ? undefined : bytes);
    } catch (error) {
      if (error instanceof HttpError)
        return reply(res, error.status, { error: error.message });
      const publicMessage = (error as { publicMessage?: unknown })
        ?.publicMessage;
      reply(res, 500, {
        error:
          typeof publicMessage === "string"
            ? publicMessage.slice(0, 300)
            : "服务暂时无法完成请求，请检查配置后重试。",
      });
    }
  });
  server.requestTimeout = 150000;
  server.headersTimeout = 10000;
  server.on("close", () => {
    shuttingDown = true;
    for (const controller of active.values()) controller.abort();
  });
  return server;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const store = new Store(
    process.env.DATABASE_URL,
    process.env.APP_TIMEZONE || "Asia/Shanghai",
  );
  await store.migrate();
  const server =
    process.env.APP_MODE === "public"
      ? (await import("./public-server")).createPublicApiServer({ store })
      : createApiServer({ store });
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () =>
    process.stdout.write(
      `Guanxing local server listening on ${host}:${port}\n`,
    ),
  );
  const stop = async () => {
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    if ("stopWorker" in server && typeof server.stopWorker === "function")
      await server.stopWorker();
    server.closeAllConnections();
    server.close(() => {
      void store.close().finally(() => process.exit(0));
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    process.stderr.write(
      "Guanxing server failed to start. Check DATABASE_URL, PostgreSQL/pgvector and port settings.\n",
    );
    process.exitCode = 1;
  });
