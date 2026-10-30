import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "./store";
import type { Account } from "./public-types";
import type { ModelProfile } from "./types";
import { runAgent } from "./agent";
import { embeddingStatus } from "./embedding";
import { CredentialVault } from "./vault";
import { JobWorker } from "./jobs";
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

export interface PublicServerOptions {
  store: Store;
  appSecret?: string;
  setupToken?: string;
  allowedOrigins?: string[];
  trustProxy?: boolean;
  runner?: typeof runAgent;
  staticDir?: string;
  startWorker?: boolean;
}

function username(value: unknown) {
  const text = string(value, "用户名", 3, 32).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(text))
    fail(400, "用户名请使用 3—32 位英文字母、数字、下划线或短横线。");
  return text;
}
function password(value: unknown, min = 12) {
  if (typeof value !== "string" || value.length < min || value.length > 256)
    fail(400, `密码需要 ${min}—256 个字符。`);
  return value;
}

export function createPublicApiServer(options: PublicServerOptions) {
  const store = options.store;
  const vault = new CredentialVault(
    options.appSecret ?? process.env.APP_SECRET ?? "",
  );
  const setupToken = options.setupToken ?? process.env.SETUP_TOKEN ?? "";
  if (setupToken.length < 24)
    throw new Error("A strong SETUP_TOKEN is required for public mode.");
  const configured =
    options.allowedOrigins ??
    (process.env.APP_ORIGIN || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  for (const value of configured) {
    const url = new URL(value);
    if (url.origin !== value || !["http:", "https:"].includes(url.protocol))
      throw new Error("APP_ORIGIN must contain exact http(s) origins.");
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error(
        "Public accounts require HTTPS; use a localhost SSH tunnel before configuring a domain.",
      );
  }
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === "1";
  const worker = new JobWorker(store, vault, options.runner);
  const staticDir = resolve(
    options.staticDir ?? fileURLToPath(new URL("../dist", import.meta.url)),
  );
  let stopping = false;
  const limits = new Map<string, { count: number; until: number }>();
  const origins = (req: IncomingMessage) => [
    ...configured,
    `http://127.0.0.1:${req.socket.localPort}`,
    `http://localhost:${req.socket.localPort}`,
  ];
  function clientIp(req: IncomingMessage) {
    const supplied = req.headers["x-real-ip"];
    return trustProxy &&
      typeof supplied === "string" &&
      /^[a-fA-F0-9:.]{2,64}$/.test(supplied)
      ? supplied
      : req.socket.remoteAddress || "unknown";
  }
  function throttle(key: string, max: number, ms: number) {
    const now = Date.now();
    if (limits.size > 2000)
      for (const [id, value] of limits)
        if (value.until <= now) limits.delete(id);
    const current = limits.get(key);
    if (current && current.until > now) {
      if (current.count >= max) fail(429, "操作过于频繁，请稍后再试。");
      current.count++;
    } else {
      if (limits.size >= 5000) fail(429, "服务请求较多，请稍后再试。");
      limits.set(key, { count: 1, until: now + ms });
    }
  }
  async function currentUser(req: IncomingMessage) {
    const token = cookieToken(req);
    return token ? store.authUser(digest(token)) : null;
  }
  async function signIn(
    req: IncomingMessage,
    res: ServerResponse,
    userId: string,
    expectedPasswordHash: string,
  ) {
    const old = cookieToken(req);
    if (old) await store.deleteAuthSession(digest(old));
    const token = randomBytes(32).toString("base64url");
    const signedIn = await store.addAuthSession(
      digest(token),
      new Date(Date.now() + SESSION_MS),
      userId,
      expectedPasswordHash,
    );
    if (!signedIn) fail(401, "账号状态已改变，请重新登录。");
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${req.headers.origin?.startsWith("https:") ? "; Secure" : ""}`,
    );
  }
  const admin = (user: Account) => {
    if (user.role !== "admin") fail(403, "此操作仅限管理员。");
  };
  async function mutate<T>(action: () => Promise<T>) {
    const release = await store.acquireRunLock();
    if (!release) fail(409, "有解读任务正在运行，请稍后再修改这项配置。");
    try {
      return await action();
    } finally {
      await release();
    }
  }
  async function modelsFor(user: Account) {
    const profiles = await store.listModels();
    const models = await Promise.all(
      profiles.map(async (profile) => {
        const hosted = Boolean(await store.getModelSecret(profile.id));
        return user.role === "admin"
          ? { ...profile, hosted }
          : {
              id: profile.id,
              name: profile.name,
              model: profile.model,
              enabled: profile.enabled,
              hosted,
              baseUrl: "",
              inputPricePerMillion: 0,
              outputPricePerMillion: 0,
              currency: profile.currency,
              dailyTokenLimit: 0,
              dailyCostLimit: 0,
            };
      }),
    );
    return user.role === "admin"
      ? models
      : models.filter((m) => m.enabled && m.hosted);
  }
  async function validateModel(value: Record<string, unknown>) {
    const model = modelInput(value);
    if (model.dailyTokenLimit <= 0)
      fail(400, "公开服务请设置大于零的模型每日 Token 上限，防止无上限消耗。");
    return model;
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
      if (stopping) fail(503, "服务正在停止，请稍后重试。");
      const allowed = origins(req);
      if (
        !req.headers.host ||
        !allowed.some(
          (value) =>
            new URL(value).host.toLowerCase() ===
            req.headers.host?.toLowerCase(),
        )
      )
        fail(403, "此主机未获准访问，请配置 APP_ORIGIN。");
      const path = new URL(req.url || "/", `http://${req.headers.host}`)
        .pathname;
      const method = req.method || "GET";
      if (path.startsWith("/api/")) {
        if (
          !["GET", "HEAD"].includes(method) &&
          (!req.headers.origin ||
            !allowed.includes(req.headers.origin) ||
            req.headers["sec-fetch-site"] === "cross-site")
        )
          fail(403, "请求来源不被允许。");
        const user = await currentUser(req);
        if (path === "/api/health" && method === "GET") {
          const settings = await store.getSiteSettings();
          return reply(res, 200, {
            ok: true,
            version: "3.1.2",
            mode: "public",
            needsSetup: !(await store.hasOwner()),
            authenticated: Boolean(user),
            user: user ?? undefined,
            registrationOpen: settings.registrationOpen,
            dailyRunLimit: settings.dailyRunLimit,
            requiresSetupToken: true,
            hostedModels: (await store.listModels()).some((m) => m.enabled),
          });
        }
        if (
          ["/api/auth/setup", "/api/auth/login", "/api/auth/register"].includes(
            path,
          ) &&
          method === "POST"
        ) {
          throttle(`auth-ip:${clientIp(req)}`, 20, 10 * 60000);
          const data = await body(req);
          const name = username(
            data.username ?? (path.endsWith("setup") ? "admin" : ""),
          );
          throttle(`auth-user:${name}`, 10, 10 * 60000);
          const pass = password(data.password, path.endsWith("login") ? 1 : 12);
          let account: Account | null;
          let verifiedHash: string;
          if (path.endsWith("setup")) {
            if (await store.hasOwner()) fail(409, "管理员已经初始化，请登录。");
            const provided =
              typeof data.setupToken === "string" ? data.setupToken : "";
            if (
              !timingSafeEqual(
                Buffer.from(digest(provided), "hex"),
                Buffer.from(digest(setupToken), "hex"),
              )
            )
              fail(
                403,
                "初始化口令不正确，请在服务器部署配置中查看 SETUP_TOKEN。",
              );
            verifiedHash = await hashPassword(pass);
            if (!(await store.setupOwner(verifiedHash, name)))
              fail(409, "管理员已经初始化。");
            account = await store.getAccount("owner");
          } else if (path.endsWith("register")) {
            if (
              !(await store.hasOwner()) ||
              !(await store.getSiteSettings()).registrationOpen
            )
              fail(403, "网站暂未开放注册，请联系管理员。");
            verifiedHash = await hashPassword(pass);
            account = await store.createAccount({
              username: name,
              passwordHash: verifiedHash,
            });
          } else {
            const stored = await store.accountByUsername(name);
            if (
              !(await verifyPassword(pass, stored?.passwordHash)) ||
              !stored ||
              stored.disabled
            )
              fail(401, "用户名或密码不正确，或账号已停用。");
            const { passwordHash: _passwordHash, ...safe } = stored;
            verifiedHash = _passwordHash;
            account = safe;
          }
          if (!account) fail(500, "账号初始化未完成。");
          await signIn(req, res, account.id, verifiedHash);
          limits.delete(`auth-user:${name}`);
          return reply(res, 200, { ok: true, user: account });
        }
        if (!user) fail(401, "请先登录你的观星账号。");
        const scoped = store.forUser(user.id);
        if (!["GET", "HEAD"].includes(method))
          throttle(`write:${user.id}`, 50, 60000);
        if (path === "/api/auth/logout" && method === "POST") {
          const token = cookieToken(req);
          if (token) await store.deleteAuthSession(digest(token));
          res.setHeader(
            "Set-Cookie",
            `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
          );
          return reply(res, 200, { ok: true });
        }
        if (path === "/api/auth/password" && method === "POST") {
          throttle(`password:${user.id}`, 5, 10 * 60000);
          const data = await body(req);
          const stored = await store.accountByUsername(user.username);
          if (
            !(await verifyPassword(
              password(data.currentPassword, 1),
              stored?.passwordHash,
            ))
          )
            fail(400, "当前密码不正确。");
          const nextHash = await hashPassword(password(data.newPassword));
          if (
            !(await store.updateAccount(
              user.id,
              { passwordHash: nextHash },
              stored?.passwordHash,
            ))
          )
            fail(401, "账号状态已改变，请重新登录。");
          await signIn(req, res, user.id, nextHash);
          return reply(res, 200, { ok: true });
        }
        if (path === "/api/account" && method === "GET")
          return reply(res, 200, {
            user,
            dailyRunLimit: (await store.getSiteSettings()).dailyRunLimit,
            usedToday: (await scoped.dailyJobUsage()).used,
          });
        if (path.startsWith("/api/admin/")) {
          admin(user);
          if (path === "/api/admin/settings" && method === "GET")
            return reply(res, 200, { settings: await store.getSiteSettings() });
          if (path === "/api/admin/settings" && method === "PUT") {
            const data = await body(req);
            const value = (data.settings ?? data) as Record<string, unknown>;
            if (
              typeof value.registrationOpen !== "boolean" ||
              !Number.isSafeInteger(value.dailyRunLimit) ||
              Number(value.dailyRunLimit) < 1 ||
              Number(value.dailyRunLimit) > 100
            )
              fail(400, "每日任务上限需为 1—100，注册开关需为布尔值。");
            return reply(res, 200, {
              settings: await store.updateSiteSettings({
                registrationOpen: value.registrationOpen,
                dailyRunLimit: Number(value.dailyRunLimit),
              }),
            });
          }
          if (path === "/api/admin/users" && method === "GET")
            return reply(res, 200, { users: await store.listAccounts() });
          const accountMatch = path.match(
            /^\/api\/admin\/users\/([^/]+)(\/password)?$/,
          );
          if (accountMatch && ["PATCH", "POST"].includes(method)) {
            const target = await store.getAccount(accountMatch[1]);
            if (!target) fail(404, "账号不存在。");
            const data = await body(req);
            if (accountMatch[2] && method === "POST") {
              if (target.id === user.id)
                fail(400, "请在个人账号中修改自己的密码。");
              await store.updateAccount(target.id, {
                passwordHash: await hashPassword(password(data.password)),
              });
            } else if (!accountMatch[2] && method === "PATCH") {
              if (target.role === "admin" || target.id === user.id)
                fail(400, "不能停用管理员账号。");
              if (typeof data.disabled !== "boolean")
                fail(400, "账号状态格式不正确。");
              await store.updateAccount(target.id, { disabled: data.disabled });
            } else fail(405, "请求方法不正确。");
            return reply(res, 200, { ok: true });
          }
          if (path === "/api/admin/usage" && method === "GET")
            return reply(res, 200, {
              ...(await store.dashboardAll()),
              embedding: embeddingStatus(),
            });
          fail(404, "管理接口不存在。");
        }
        if (path === "/api/sessions" && method === "GET")
          return reply(res, 200, { sessions: await scoped.listSessions() });
        if (path === "/api/sessions" && method === "POST") {
          if ((await scoped.listSessions()).length >= 200)
            fail(400, "最多保留 200 个对话，请先删除不需要的记录。");
          const data = await body(req);
          return reply(res, 201, {
            session: await scoped.createSession({
              title:
                data.title === undefined
                  ? undefined
                  : string(data.title, "标题", 1, 120),
              birth: birthInput(data.birth),
            }),
          });
        }
        let match = path.match(/^\/api\/sessions\/([^/]+)$/);
        if (match && method === "GET") {
          const session = await scoped.getSession(match[1]);
          if (!session) fail(404, "对话不存在。");
          return reply(res, 200, {
            session,
            messages: await scoped.listMessages(session.id),
            runs: await scoped.listRuns(session.id),
            jobs: await scoped.listSessionJobs(session.id),
          });
        }
        if (match && method === "DELETE") {
          const id = match[1];
          await mutate(async () => {
            if (
              (await scoped.listJobs()).some(
                (j) =>
                  j.sessionId === id &&
                  ["queued", "running"].includes(j.status),
              )
            )
              fail(409, "请先停止这个对话中的任务。");
            if (!(await scoped.deleteSession(id))) fail(404, "对话不存在。");
          });
          return reply(res, 200, { ok: true });
        }
        if (path === "/api/models" && method === "GET")
          return reply(res, 200, { models: await modelsFor(user) });
        if (path === "/api/models" && method === "POST") {
          admin(user);
          const input = await validateModel(await body(req));
          return reply(res, 201, {
            model: await mutate(() => store.saveModel(input)),
          });
        }
        match = path.match(/^\/api\/models\/([^/]+)(\/secret)?$/);
        if (match && ["POST", "PUT", "DELETE"].includes(method)) {
          admin(user);
          const id = match[1];
          if (!(await store.getModel(id))) fail(404, "模型配置不存在。");
          if (match[2]) {
            if (method === "POST") {
              const key = string((await body(req)).apiKey, "API Key", 1, 512);
              if (/[\r\n]/.test(key)) fail(400, "API Key 格式不正确。");
              await mutate(() =>
                store.setModelSecret(id, vault.encrypt(id, key)),
              );
            } else if (method === "DELETE")
              await mutate(() => store.setModelSecret(id, null));
            else fail(405, "请求方法不正确。");
            return reply(res, 200, { ok: true });
          }
          if (method === "PUT") {
            const input = await validateModel(await body(req));
            return reply(res, 200, {
              model: await mutate(() => store.saveModel(input, id)),
            });
          }
          if (method === "DELETE") {
            await mutate(() => store.deleteModel(id));
            return reply(res, 200, { ok: true });
          }
        }
        if (path === "/api/memories" && method === "GET")
          return reply(res, 200, { memories: await scoped.listMemories() });
        if (path === "/api/memories" && method === "POST") {
          if ((await scoped.listMemories()).length >= 500)
            fail(400, "最多保留 500 条记忆，请先整理已有记忆。");
          const data = await body(req);
          const sessionId =
            data.sessionId == null
              ? null
              : string(data.sessionId, "对话 ID", 1, 80);
          if (sessionId && !(await scoped.getSession(sessionId)))
            fail(404, "对话不存在。");
          return reply(res, 201, {
            memory: await scoped.addMemory({
              content: string(data.content, "记忆", 1, 4000),
              sessionId,
              status: "active",
            }),
          });
        }
        if (path === "/api/memories/reindex" && method === "POST")
          fail(400, "当前未接入向量模型，使用文本与近期记忆检索。");
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
          if (!Object.keys(patch).length) fail(400, "没有要修改的内容。");
          const memory = await scoped.updateMemory(match[1], patch);
          if (!memory) fail(404, "记忆不存在。");
          return reply(res, 200, { memory });
        }
        if (match && method === "DELETE") {
          if (!(await scoped.deleteMemory(match[1]))) fail(404, "记忆不存在。");
          return reply(res, 200, { ok: true });
        }
        if (path === "/api/usage" && method === "GET")
          return reply(res, 200, {
            ...(await scoped.dashboard()),
            models: await modelsFor(user),
            embedding: embeddingStatus(),
          });
        if (path === "/api/export" && method === "GET")
          return reply(res, 200, {
            ...(await scoped.exportData()),
            models: await modelsFor(user),
          });
        if (path === "/api/jobs" && method === "GET") {
          const active =
            new URL(req.url!, "http://localhost").searchParams.get("active") ===
            "1";
          const jobs = await scoped.listJobs();
          return reply(res, 200, {
            jobs: active
              ? jobs.filter((j) => ["queued", "running"].includes(j.status))
              : jobs,
          });
        }
        match = path.match(/^\/api\/sessions\/([^/]+)\/jobs$/);
        if (match && method === "POST") {
          const data = await body(req);
          if ("apiKey" in data)
            fail(400, "公开服务由管理员配置模型，无需提交个人密钥。");
          const content = string(data.content, "问题", 1, 6000);
          const modelId = string(data.modelId, "模型 ID", 1, 80);
          const idempotencyKey = string(
            data.idempotencyKey,
            "请求标识",
            8,
            100,
          );
          const model = await store.getModel(modelId);
          if (
            !model?.enabled ||
            model.dailyTokenLimit <= 0 ||
            !(await store.getModelSecret(modelId))
          )
            fail(400, "这个模型尚未开放，请稍后重试。");
          const settings = await store.getSiteSettings();
          const job = await scoped.enqueueJob(
            {
              userId: user.id,
              sessionId: match[1],
              modelId,
              content,
              idempotencyKey,
            },
            settings.dailyRunLimit,
          );
          if (options.startWorker !== false) worker.wake();
          return reply(res, 202, { job });
        }
        match = path.match(/^\/api\/jobs\/([^/]+)(\/cancel)?$/);
        if (match && method === "GET" && !match[2]) {
          const job = await scoped.getJob(match[1]);
          if (!job) fail(404, "任务不存在。");
          return reply(res, 200, { job });
        }
        if (match && method === "POST" && match[2]) {
          if (!(await scoped.getJob(match[1]))) fail(404, "任务不存在。");
          await scoped.requestCancelJob(match[1]);
          worker.cancel(match[1]);
          return reply(res, 200, { ok: true });
        }
        fail(404, "接口不存在。");
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
      const types: Record<string, string> = {
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
      const bytes = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Cache-Control":
          extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
      });
      res.end(method === "HEAD" ? undefined : bytes);
    } catch (error) {
      const candidate = error as { status?: number; publicMessage?: string };
      const status =
        error instanceof HttpError
          ? error.status
          : candidate.status &&
              candidate.status >= 400 &&
              candidate.status < 500
            ? candidate.status
            : 500;
      const message =
        error instanceof HttpError
          ? error.message
          : candidate.publicMessage || "服务暂时无法完成请求，请稍后重试。";
      reply(res, status, { error: message.slice(0, 300) });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.on("listening", () => {
    if (options.startWorker !== false) worker.start();
  });
  server.on("close", () => {
    stopping = true;
    void worker.stop();
  });
  return Object.assign(server, {
    stopWorker: async () => {
      stopping = true;
      await worker.stop();
    },
  });
}
