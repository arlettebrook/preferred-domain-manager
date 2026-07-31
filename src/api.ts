import { SETTINGS_KEY } from "./config";
import { createSession, expiredCookie, isValidSession, sessionCookie } from "./security/session";
import { collectPreferredIps } from "./services/ip-sources";
import { getSettings, publicSettings } from "./services/settings";
import { runSync } from "./services/sync";
import { createDnsRecord, deleteDnsRecord, isEditableDnsRecord, listDnsRecords, updateDnsRecord } from "./services/cloudflare-dns";
import { Env, IpSource, Settings } from "./types";
import { DEFAULT_ADMIN_PATH, dedupeIps, isValidAdminPath, normalizeAdminPath, normalizeDomain } from "./validation";
import { LockBusyError, HttpError } from "./errors";
import { json, readJson } from "./http";
import { deleteTelegramWebhook, setTelegramCommands, setTelegramWebhook, telegramBotInfo } from "./services/telegram";

async function requireAuth(request: Request, env: Env) {
  if (!(await isValidSession(request, env))) throw new HttpError(401, "未登录或登录已过期");
}

async function saveConfig(request: Request, env: Env) {
  const input = await readJson<{
    ipSources?: Array<Partial<IpSource>>;
    manualIps?: string[];
    adminPath?: string;
    defaultDomain?: string;
    cfZoneId?: string;
    cfApiToken?: string;
    telegramBotToken?: string;
    telegramAllowedUserIds?: string[] | string;
    telegramWebhookSecret?: string;
  }>(request);
  const previous = await getSettings(env);
  const adminPath = input.adminPath !== undefined ? normalizeAdminPath(String(input.adminPath)) : normalizeAdminPath(previous.adminPath || DEFAULT_ADMIN_PATH);
  if (!isValidAdminPath(adminPath)) throw new HttpError(400, "管理员访问路径格式无效，仅支持类似 /admin 或 /manage 的路径，且不能使用 API/Webhook 路径");
  const ipSources = (input.ipSources ?? previous.ipSources ?? []).map((source) => ({
    id: String(source.id || crypto.randomUUID()),
    url: String(source.url || "").trim(),
    enabled: source.enabled !== false,
  })).filter((source) => /^https?:\/\//i.test(source.url));
  const settings: Settings = {
    ipSources,
    manualIps: dedupeIps((input.manualIps ?? previous.manualIps ?? []).flatMap((item) => String(item).split(/[\s,]+/))),
    adminPath,
    defaultDomain: input.defaultDomain !== undefined ? normalizeDomain(String(input.defaultDomain)) : normalizeDomain(previous.defaultDomain || ""),
    cfZoneId: input.cfZoneId !== undefined ? String(input.cfZoneId).trim() : String(previous.cfZoneId || "").trim(),
    cfApiToken: typeof input.cfApiToken === "string" && input.cfApiToken ? input.cfApiToken : previous.cfApiToken,
    telegramBotToken: typeof input.telegramBotToken === "string" && input.telegramBotToken ? input.telegramBotToken : previous.telegramBotToken,
    telegramAllowedUserIds: input.telegramAllowedUserIds !== undefined
      ? (Array.isArray(input.telegramAllowedUserIds) ? input.telegramAllowedUserIds : String(input.telegramAllowedUserIds).split(/[,\s]+/)).map(String).map((id) => id.trim()).filter((id) => /^\d+$/.test(id)).slice(0, 50)
      : previous.telegramAllowedUserIds ?? [],
    telegramWebhookSecret: typeof input.telegramWebhookSecret === "string" && input.telegramWebhookSecret ? input.telegramWebhookSecret : previous.telegramWebhookSecret,
    updatedAt: new Date().toISOString(),
  };
  await env.PDM_KV.put(SETTINGS_KEY, JSON.stringify(settings));
  const persisted = await env.PDM_KV.get<Settings>(SETTINGS_KEY, "json");
  if (!persisted) throw new HttpError(500, "配置写入 KV 后无法读取，请检查 PDM_KV 绑定");
  return json(publicSettings(persisted), 200, { "cache-control": "no-store" });
}

export async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const { password } = await readJson<{ password?: string }>(request);
    if (!env.ADMIN_PASSWORD || !password || password !== env.ADMIN_PASSWORD) throw new HttpError(401, "密码错误");
    const token = await createSession(env.SESSION_SECRET || env.ADMIN_PASSWORD);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, request) });
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") return json({ ok: true }, 200, { "set-cookie": expiredCookie() });
  if (url.pathname === "/telegram/webhook" && request.method === "POST") throw new HttpError(404, "Telegram Webhook 路径不可通过 API 路由访问");
  await requireAuth(request, env);

  if (url.pathname === "/api/telegram/test" && request.method === "POST") {
    const settings = await getSettings(env);
    return json({ bot: await telegramBotInfo(settings) });
  }
  if (url.pathname === "/api/telegram/webhook" && request.method === "POST") {
    const settings = await getSettings(env);
    return json({ ok: true, webhookUrl: await setTelegramWebhook(settings, `${new URL(request.url).origin}/telegram/webhook`) });
  }
  if (url.pathname === "/api/telegram/webhook" && request.method === "DELETE") {
    await deleteTelegramWebhook(await getSettings(env));
    return json({ ok: true });
  }
  if (url.pathname === "/api/telegram/commands" && request.method === "POST") {
    await setTelegramCommands(await getSettings(env));
    return json({ ok: true });
  }

  const dnsMatch = url.pathname.match(/^\/api\/dns\/records(?:\/([^/]+))?$/);
  if (dnsMatch) {
    const settings = await getSettings(env);
    const target = settings.defaultDomain && settings.cfZoneId ? { domain: settings.defaultDomain, zoneId: settings.cfZoneId } : undefined;
    if (!target) throw new HttpError(400, "请先在设置中保存 DEFAULT_DOMAIN 和 CF_ZONE_ID");
    if (request.method === "GET" && !dnsMatch[1]) return json({ records: (await listDnsRecords(target, env, settings.cfApiToken)).filter((record) => isEditableDnsRecord(target, record)), domain: target.domain }, 200, { "cache-control": "no-store" });
    if (request.method === "POST" && !dnsMatch[1]) {
      const body = await readJson<Record<string, unknown>>(request);
      return json({ record: await createDnsRecord(target, body, env, settings.cfApiToken) }, 201);
    }
    if (request.method === "PUT" && dnsMatch[1]) {
      const body = await readJson<Record<string, unknown>>(request);
      return json({ record: await updateDnsRecord(target, dnsMatch[1], body, env, settings.cfApiToken) });
    }
    if (request.method === "DELETE" && dnsMatch[1]) { await deleteDnsRecord(target, dnsMatch[1], env, settings.cfApiToken); return json({ ok: true }); }
    throw new HttpError(405, "不支持的 DNS 操作");
  }

  if (url.pathname === "/api/auth/me") return json({ authenticated: true });
  if (url.pathname === "/api/config" && request.method === "GET") return json(publicSettings(await getSettings(env)), 200, { "cache-control": "no-store" });
  if (url.pathname === "/api/config" && request.method === "PUT") return saveConfig(request, env);
  if (url.pathname === "/api/ips/preview" && request.method === "POST") return json(await collectPreferredIps(await getSettings(env), true));
  if (url.pathname === "/api/sync" && request.method === "POST") {
    try {
      return json({ ok: true, ...(await runSync(env)) });
    } catch (error) {
      if (error instanceof LockBusyError) return json({ ok: false, error: error.message }, 409);
      throw error;
    }
  }
  throw new HttpError(404, "接口不存在");
}
