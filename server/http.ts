import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ModelProfile } from "./types";
import { createChart, type ChartInput } from "../src/lib/chart";
import { resolveModelEndpoint } from "./agent";

export const COOKIE = "guanxing_session";
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, result) => (error ? reject(error) : resolve(result)),
    ),
  );
export async function hashPassword(password: string) {
  const salt = randomBytes(24);
  const key = await derive(password, salt);
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, stored?: string) {
  const parts = stored?.split(":");
  const valid =
    parts?.length === 3 &&
    parts[0] === "scrypt" &&
    /^[a-f0-9]{48}$/.test(parts[1]) &&
    /^[a-f0-9]{128}$/.test(parts[2]);
  const salt = valid ? Buffer.from(parts![1], "hex") : Buffer.alloc(24);
  const expected = valid ? Buffer.from(parts![2], "hex") : Buffer.alloc(64);
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected) && Boolean(valid);
}
export function cookieToken(req: IncomingMessage) {
  const value = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function reply(res: ServerResponse, status: number, value: unknown) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
export async function body(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  if (
    !req.headers["content-type"]?.toLowerCase().startsWith("application/json")
  )
    fail(415, "请使用 JSON 请求。");
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) fail(413, "请求内容过大。");
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result))
      fail(400, "请求格式不正确。");
    return result;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return fail(400, "JSON 格式不正确。");
  }
}
export function string(value: unknown, label: string, min = 1, max = 4000) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max
  )
    fail(400, `${label}长度需为 ${min}—${max} 字。`);
  return value.trim();
}
export function birthInput(value: unknown): ChartInput | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value))
    fail(400, "出生信息格式不正确。");
  const v = value as Record<string, unknown>;
  const input = {
    date: v.date,
    hour: v.hour,
    gender: v.gender,
    ...(v.name !== undefined ? { name: v.name } : {}),
  } as ChartInput;
  try {
    createChart(input);
  } catch (e) {
    fail(400, (e as Error).message);
  }
  return input;
}
export function modelInput(
  value: Record<string, unknown>,
): Omit<ModelProfile, "id"> {
  if ("apiKey" in value || "key" in value || "token" in value)
    fail(400, "模型配置不保存密钥；请在运行时临时填写。");
  const name = string(value.name, "配置名称", 1, 100),
    baseUrl = string(value.baseUrl, "服务地址", 1, 2048),
    model = string(value.model, "模型名称", 1, 200);
  try {
    resolveModelEndpoint(baseUrl);
  } catch {
    fail(400, "服务地址不被允许，请使用 HTTPS 和已配置的模型主机。");
  }
  if (typeof value.enabled !== "boolean") fail(400, "enabled 必须为布尔值。");
  if (!["USD", "CNY"].includes(value.currency as string))
    fail(400, "计价币种仅支持 USD / CNY。");
  const numbers: Record<string, number> = {};
  for (const key of [
    "inputPricePerMillion",
    "outputPricePerMillion",
    "dailyTokenLimit",
    "dailyCostLimit",
  ]) {
    const v = value[key];
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < 0 ||
      v > 1e9 ||
      (key === "dailyTokenLimit" && !Number.isSafeInteger(v))
    )
      fail(400, "价格与额度必须为非负数字，Token 额度必须为整数。");
    numbers[key] = v;
  }
  if (
    numbers.dailyCostLimit > 0 &&
    numbers.inputPricePerMillion === 0 &&
    numbers.outputPricePerMillion === 0
  )
    fail(400, "设置费用额度前请配置输入或输出单价。");
  return {
    name,
    baseUrl,
    model,
    enabled: value.enabled as boolean,
    currency: value.currency as "USD" | "CNY",
    inputPricePerMillion: numbers.inputPricePerMillion,
    outputPricePerMillion: numbers.outputPricePerMillion,
    dailyTokenLimit: numbers.dailyTokenLimit,
    dailyCostLimit: numbers.dailyCostLimit,
  };
}
