import { SETTINGS_KEY } from "./config";
import { createSession, expiredCookie, isValidSession, sessionCookie } from "./security/session";
import { collectPreferredIps } from "./services/ip-sources";
import { domainProfiles, effectiveApiToken, effectiveTarget, getSettings, publicSettings } from "./services/settings";
import { runSync } from "./services/sync";
import { createDnsRecord, deleteDnsRecord, isEditableDnsRecord, listDnsRecords, updateDnsRecord } from "./services/cloudflare-dns";
import { DomainProfile, Env, IpSource, Settings } from "./types";
import { DEFAULT_ADMIN_PATH, dedupeIps, isValidAdminPath, normalizeAdminPath, normalizeDomain } from "./validation";
import { LockBusyError, HttpError } from "./errors";
import { json, readJson } from "./http";
import { deleteTelegramWebhook, setTelegramCommands, setTelegramWebhook, telegramBotInfo } from "./services/telegram";

function normalizeIpSources(input: unknown, fallback: IpSource[]) {
  const sources = Array.isArray(input) ? input : fallback;
  return sources.map((item) => {
    const source = item && typeof item === "object" ? item as Partial<IpSource> : {};
    return {
      id: String(source.id || crypto.randomUUID()),
      url: String(source.url || "").trim(),
      enabled: source.enabled !== false,
    };
  }).filter((source) => /^https?:\/\//i.test(source.url));
}

async function requireAuth(request: Request, env: Env) {
  if (!(await isValidSession(request, env))) throw new HttpError(401, "未登录或登录已过期");
}

async function saveConfig(request: Request, env: Env) {
  const input = await readJson<{
    ipSources?: Array<Partial<IpSource>>;
    manualIps?: string[];
    adminPath?: string;
    domains?: Array<Partial<DomainProfile>>;
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
  const requestedDomain = input.defaultDomain !== undefined ? normalizeDomain(String(input.defaultDomain)) : normalizeDomain(previous.defaultDomain || "");
  const requestedZoneId = input.cfZoneId !== undefined ? String(input.cfZoneId).trim() : String(previous.cfZoneId || "").trim();
  const previousDomains = domainProfiles(previous);
  const requestedDomains = input.domains?.map((item) => {
    const domain = normalizeDomain(String(item.domain || ""));
    const previousProfile = previousDomains.find((profile) => profile.id === item.id || profile.domain === domain);
    const apiToken = typeof item.apiToken === "string" && item.apiToken ? item.apiToken : previousProfile?.apiToken;
    return {
      ...item,
      apiToken,
      syncWildcard: item.syncWildcard !== undefined ? item.syncWildcard !== false : previousProfile?.syncWildcard !== false,
    };
  });
  let domains = input.domains !== undefined
    ? domainProfiles({ domains: requestedDomains as DomainProfile[], defaultDomain: requestedDomain, cfZoneId: requestedZoneId, cfApiToken: previous.cfApiToken })
    : domainProfiles(previous);
  if (input.domains === undefined && (input.defaultDomain !== undefined || input.cfZoneId !== undefined) && requestedDomain && requestedZoneId) {
    const activeIndex = domains.findIndex((item) => item.domain === normalizeDomain(previous.defaultDomain || ""));
    const legacyToken = typeof input.cfApiToken === "string" && input.cfApiToken ? input.cfApiToken : previous.cfApiToken;
    if (activeIndex >= 0) domains[activeIndex] = { ...domains[activeIndex], domain: requestedDomain, zoneId: requestedZoneId, ...(legacyToken ? { apiToken: legacyToken } : {}) };
    else domains = [{ id: `domain:${requestedDomain}`, domain: requestedDomain, zoneId: requestedZoneId, syncWildcard: true, ...(legacyToken ? { apiToken: legacyToken } : {}) }, ...domains];
  }
  const missingToken = domains.find((profile) => !profile.apiToken);
  if (missingToken) throw new HttpError(400, `请为 ${missingToken.domain} 配置独立的 Cloudflare API Token`);
  const activeDomain = domains.find((item) => item.domain === requestedDomain) || domains[0];
  const ipSources = normalizeIpSources(input.ipSources, previous.ipSources ?? []);
  const settings: Settings = {
    ipSources,
    manualIps: dedupeIps((input.manualIps ?? previous.manualIps ?? []).flatMap((item) => String(item).split(/[\s,]+/))),
    adminPath,
    domains,
    defaultDomain: activeDomain?.domain || requestedDomain,
    cfZoneId: activeDomain?.zoneId || requestedZoneId,
    cfApiToken: undefined,
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

async function saveIpSources(request: Request, env: Env) {
  const input = await readJson<{ ipSources?: unknown }>(request);
  if (!Array.isArray(input.ipSources)) throw new HttpError(400, "IP 来源必须是数组");
  const previous = await getSettings(env);
  const settings: Settings = { ...previous, ipSources: normalizeIpSources(input.ipSources, []), updatedAt: new Date().toISOString() };
  await env.PDM_KV.put(SETTINGS_KEY, JSON.stringify(settings));
  const persisted = await env.PDM_KV.get<Settings>(SETTINGS_KEY, "json");
  if (!persisted) throw new HttpError(500, "IP 来源写入 KV 后无法读取，请检查 PDM_KV 绑定");
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
    const domainId = url.searchParams.get("domainId") || undefined;
    const target = effectiveTarget(settings, domainId);
    if (!target) throw new HttpError(domainId ? 404 : 400, domainId ? "指定的域名不存在" : "请先在设置中保存默认域名和 Zone ID");
    const apiToken = effectiveApiToken(settings, domainId);
    if (!apiToken) throw new HttpError(400, `域名 ${target.domain} 尚未配置 Cloudflare API Token`);
    if (request.method === "GET" && !dnsMatch[1]) {
      const records = await listDnsRecords(target, env, apiToken);
      return json({ records: records.map((record) => ({ ...record, editable: isEditableDnsRecord(target, record) })), domain: target.domain, syncWildcard: target.syncWildcard }, 200, { "cache-control": "no-store" });
    }
    if (request.method === "POST" && !dnsMatch[1]) {
      const body = await readJson<Record<string, unknown>>(request);
      return json({ record: await createDnsRecord(target, body, env, apiToken) }, 201);
    }
    if (request.method === "PUT" && dnsMatch[1]) {
      const body = await readJson<Record<string, unknown>>(request);
      return json({ record: await updateDnsRecord(target, dnsMatch[1], body, env, apiToken) });
    }
    if (request.method === "DELETE" && dnsMatch[1]) { await deleteDnsRecord(target, dnsMatch[1], env, apiToken); return json({ ok: true }); }
    throw new HttpError(405, "不支持的 DNS 操作");
  }

  if (url.pathname === "/api/auth/me") return json({ authenticated: true });
  if (url.pathname === "/api/config" && request.method === "GET") return json(publicSettings(await getSettings(env)), 200, { "cache-control": "no-store" });
  if (url.pathname === "/api/config" && request.method === "PUT") return saveConfig(request, env);
  if (url.pathname === "/api/ip-sources" && request.method === "PUT") return saveIpSources(request, env);
  if (url.pathname === "/api/ips/collect" && request.method === "POST") return json(await collectPreferredIps(await getSettings(env), false));
  if (url.pathname === "/api/ips/preview" && request.method === "POST") return json(await collectPreferredIps(await getSettings(env), true));
  if (url.pathname === "/api/sync" && request.method === "POST") {
    try {
      return json(await runSync(env, url.searchParams.get("domainId") || undefined));
    } catch (error) {
      if (error instanceof LockBusyError) return json({ ok: false, error: error.message }, 409);
      throw error;
    }
  }
  throw new HttpError(404, "接口不存在");
}
