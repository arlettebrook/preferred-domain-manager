import { MAX_IP_SOURCE_COUNT, MAX_TCP_CHECK_ITEMS, PREFERRED_IP_CACHE_KEY, PREFERRED_IP_CACHE_TTL_MS, REGION_CATALOG_CACHE_KEY, SETTINGS_KEY } from "./config";
import { createSession, expiredCookie, isValidSession, sessionCookie } from "./security/session";
import { checkTcp443Batch, collectPreferredIps, getPreferredIpSnapshot, savePreferredIpSnapshot } from "./services/ip-sources";
import { domainProfiles, effectiveApiToken, effectiveTarget, getSettings, publicSettings } from "./services/settings";
import { runSync } from "./services/sync";
import { clearDnsRecords, createDnsRecord, deleteDnsRecord, isEditableDnsRecord, listDnsRecords, updateDnsRecord } from "./services/cloudflare-dns";
import { CollectedIps, DomainProfile, Env, IpSource, RegionCatalog, Settings } from "./types";
import { DEFAULT_ADMIN_PATH, dedupeIps, isValidAdminPath, isValidHomeRedirectUrl, normalizeAdminPath, normalizeDomain } from "./validation";
import { LockBusyError, HttpError } from "./errors";
import { json, readJson } from "./http";
import { deleteTelegramWebhook, setTelegramCommands, setTelegramWebhook, telegramBotInfo } from "./integrations/telegram/client";

function normalizeIpSources(input: unknown, fallback: IpSource[]) {
  const sources = Array.isArray(input) ? input : fallback;
  const seen = new Set<string>();
  return sources.map((item) => {
    const source = item && typeof item === "object" ? item as Partial<IpSource> : {};
    return {
      id: String(source.id || crypto.randomUUID()),
      url: String(source.url || "").trim(),
      enabled: source.enabled !== false,
      note: String(source.note || "").trim().slice(0, 120),
    };
  }).filter((source) => {
    const key = source.url.toLowerCase();
    if (!/^https?:\/\//i.test(source.url) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_IP_SOURCE_COUNT);
}

function normalizePreferredRegions(input: unknown) {
  if (input === null || input === undefined) return undefined;
  if (!Array.isArray(input)) throw new HttpError(400, "优选地区必须是数组或 null");
  const regions = [...new Set(input.map((item) => String(item).trim().toUpperCase()).filter((item) => /^[A-Z]{2,12}$/.test(item)))].sort();
  return regions.length ? regions : undefined;
}

function probeStub(env: Env) {
  return env.SYNC_LOCK.get(env.SYNC_LOCK.idFromName("preferred-ip-probe"));
}

function cronStub(env: Env) {
  return env.SYNC_LOCK.get(env.SYNC_LOCK.idFromName("preferred-ip-cron"));
}

function isRegionAwareCollected(value: CollectedIps | undefined): value is CollectedIps {
  return Boolean(value && Array.isArray(value.availableRegions) && Array.isArray(value.sources) && !(Array.isArray(value.preferredRegions) && value.preferredRegions.length === 0));
}

function createRegionCatalog(collected: CollectedIps): RegionCatalog {
  return {
    availableRegions: collected.availableRegions,
    regionCounts: collected.regionCounts,
    untaggedCount: collected.untaggedCount,
    sourceTotal: collected.sourceTotal,
    sources: collected.sources,
    fetchedAt: new Date().toISOString(),
  };
}

function allEnabledSourcesFailed(collected: CollectedIps) {
  const enabled = collected.sources.filter((source) => source.enabled);
  return enabled.length > 0 && enabled.every((source) => Boolean(source.error));
}

async function requireAuth(request: Request, env: Env) {
  if (!(await isValidSession(request, env))) throw new HttpError(401, "未登录或登录已过期");
}

async function saveConfig(request: Request, env: Env) {
  const input = await readJson<{
    ipSources?: Array<Partial<IpSource>>;
    manualIps?: string[];
    adminPath?: string;
    homeRedirectEnabled?: boolean;
    homeRedirectUrl?: string;
    domains?: Array<Partial<DomainProfile>>;
    defaultDomain?: string;
    cfZoneId?: string;
    cfApiToken?: string;
    telegramBotToken?: string;
    telegramAllowedUserIds?: string[] | string;
    telegramWebhookSecret?: string;
    cronEnabled?: boolean;
  }>(request);
  const previous = await getSettings(env);
  const adminPath = input.adminPath !== undefined ? normalizeAdminPath(String(input.adminPath)) : normalizeAdminPath(previous.adminPath || DEFAULT_ADMIN_PATH);
  if (!isValidAdminPath(adminPath)) throw new HttpError(400, "管理员访问路径格式无效，仅支持类似 /admin 或 /manage 的路径，且不能使用 API/Webhook 路径");
  const homeRedirectEnabled = input.homeRedirectEnabled !== undefined ? input.homeRedirectEnabled === true : previous.homeRedirectEnabled === true;
  const homeRedirectUrl = input.homeRedirectUrl !== undefined ? String(input.homeRedirectUrl).trim() : String(previous.homeRedirectUrl || "").trim();
  if (homeRedirectUrl && !isValidHomeRedirectUrl(homeRedirectUrl)) throw new HttpError(400, "首页伪装目标链接无效，请使用完整的 http:// 或 https:// 地址");
  if (homeRedirectUrl && new URL(homeRedirectUrl).origin === new URL(request.url).origin) throw new HttpError(400, "首页伪装目标链接不能使用当前站点地址，否则可能产生循环重定向");
  if (homeRedirectEnabled && !homeRedirectUrl) throw new HttpError(400, "开启首页伪装前请先填写目标链接");
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
    preferredRegions: previous.preferredRegions,
    adminPath,
    homeRedirectEnabled,
    homeRedirectUrl,
    domains,
    defaultDomain: activeDomain?.domain || requestedDomain,
    cfZoneId: activeDomain?.zoneId || requestedZoneId,
    cfApiToken: undefined,
    telegramBotToken: typeof input.telegramBotToken === "string" && input.telegramBotToken ? input.telegramBotToken : previous.telegramBotToken,
    telegramAllowedUserIds: input.telegramAllowedUserIds !== undefined
      ? (Array.isArray(input.telegramAllowedUserIds) ? input.telegramAllowedUserIds : String(input.telegramAllowedUserIds).split(/[,\s]+/)).map(String).map((id) => id.trim()).filter((id) => /^\d+$/.test(id)).slice(0, 50)
      : previous.telegramAllowedUserIds ?? [],
    telegramWebhookSecret: typeof input.telegramWebhookSecret === "string" && input.telegramWebhookSecret ? input.telegramWebhookSecret : previous.telegramWebhookSecret,
    cronEnabled: input.cronEnabled !== undefined ? input.cronEnabled !== false : previous.cronEnabled !== false,
    updatedAt: new Date().toISOString(),
  };
  await env.PDM_KV.put(SETTINGS_KEY, JSON.stringify(settings));
  await env.PDM_KV.delete(PREFERRED_IP_CACHE_KEY);
  const persisted = await env.PDM_KV.get<Settings>(SETTINGS_KEY, "json");
  if (!persisted) throw new HttpError(500, "配置写入 KV 后无法读取，请检查 PDM_KV 绑定");
  return json(publicSettings(persisted), 200, { "cache-control": "no-store" });
}

async function saveIpSources(request: Request, env: Env) {
  const input = await readJson<{ ipSources?: unknown }>(request);
  if (!Array.isArray(input.ipSources)) throw new HttpError(400, "IP 来源必须是数组");
  const previous = await getSettings(env);
  const nextIpSources = normalizeIpSources(input.ipSources, []);
  const settings: Settings = {
    ...previous,
    ipSources: nextIpSources,
    preferredRegions: previous.preferredRegions,
    updatedAt: new Date().toISOString(),
  };
  await env.PDM_KV.put(SETTINGS_KEY, JSON.stringify(settings));
  await env.PDM_KV.delete(PREFERRED_IP_CACHE_KEY);
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
    if (request.method === "DELETE" && !dnsMatch[1]) return json({ ok: true, deleted: await clearDnsRecords(target, env, apiToken) });
    if (request.method === "DELETE" && dnsMatch[1]) { await deleteDnsRecord(target, dnsMatch[1], env, apiToken); return json({ ok: true }); }
    throw new HttpError(405, "不支持的 DNS 操作");
  }

  if (url.pathname === "/api/auth/me") return json({ authenticated: true });
  if (url.pathname === "/api/config" && request.method === "GET") return json(publicSettings(await getSettings(env)), 200, { "cache-control": "no-store" });
  if (url.pathname === "/api/config" && request.method === "PUT") return saveConfig(request, env);
  if (url.pathname === "/api/cron/config" && request.method === "PUT") {
    const body = await readJson<{ enabled?: unknown }>(request);
    if (typeof body.enabled !== "boolean") throw new HttpError(400, "定时任务开关必须是布尔值");
    const previous = await getSettings(env);
    const settings: Settings = { ...previous, cronEnabled: body.enabled };
    await env.PDM_KV.put(SETTINGS_KEY, JSON.stringify(settings));
    if (!body.enabled) await cronStub(env).fetch("https://probe/cron/cancel", { method: "POST" });
    return json({ cronEnabled: body.enabled });
  }
  if (url.pathname === "/api/ip-sources" && request.method === "PUT") return saveIpSources(request, env);
  if (url.pathname === "/api/ips/regions" && request.method === "GET") {
    const catalog = await env.PDM_KV.get<RegionCatalog>(REGION_CATALOG_CACHE_KEY, "json");
    return json(catalog ? { available: true, ...catalog } : { available: false }, 200, { "cache-control": "no-store" });
  }
  if (url.pathname === "/api/ips/regions" && request.method === "POST") {
    const input = await readJson<{ ipSources?: unknown }>(request);
    if (input.ipSources !== undefined && !Array.isArray(input.ipSources)) throw new HttpError(400, "IP 来源必须是数组");
    const settings = await getSettings(env);
    const ipSources = input.ipSources === undefined ? settings.ipSources : normalizeIpSources(input.ipSources, []);
    const collected = await collectPreferredIps({ ...settings, ipSources, preferredRegions: undefined }, false);
    if (allEnabledSourcesFailed(collected)) throw new HttpError(502, "所有启用的 IP 来源获取失败，已保留原地区目录");
    const catalog = createRegionCatalog(collected);
    await env.PDM_KV.put(REGION_CATALOG_CACHE_KEY, JSON.stringify(catalog));
    return json({ available: true, ...catalog }, 200, { "cache-control": "no-store" });
  }
  if (url.pathname === "/api/ips/regions/config" && request.method === "PUT") {
    const input = await readJson<{ preferredRegions?: unknown }>(request);
    if (input.preferredRegions === undefined) throw new HttpError(400, "缺少地区配置");
    const preferredRegions = normalizePreferredRegions(input.preferredRegions);
    const previous = await getSettings(env);
    const unchanged = JSON.stringify(preferredRegions ?? null) === JSON.stringify(previous.preferredRegions ?? null);
    if (unchanged) return json({ preferredRegions: previous.preferredRegions ?? null, updatedAt: previous.updatedAt, unchanged: true }, 200, { "cache-control": "no-store" });
    const settings: Settings = { ...previous, preferredRegions, updatedAt: new Date().toISOString() };
    await env.PDM_KV.put(SETTINGS_KEY, JSON.stringify(settings));
    await env.PDM_KV.delete(PREFERRED_IP_CACHE_KEY);
    await probeStub(env).fetch("https://probe/probe/clear", { method: "POST" });
    await cronStub(env).fetch("https://probe/cron/cancel", { method: "POST" });
    return json({ preferredRegions: settings.preferredRegions ?? null, updatedAt: settings.updatedAt }, 200, { "cache-control": "no-store" });
  }
  if (url.pathname === "/api/ips/collect" && request.method === "POST") {
    const settings = await getSettings(env);
    const collected = await collectPreferredIps(settings, false);
    const catalog = allEnabledSourcesFailed(collected) ? undefined : createRegionCatalog(collected);
    if (catalog) await env.PDM_KV.put(REGION_CATALOG_CACHE_KEY, JSON.stringify(catalog));
    await probeStub(env).fetch("https://probe/probe/start", { method: "POST", body: JSON.stringify({ settingsUpdatedAt: settings.updatedAt, collected }) });
    return json({ ...collected, batchSize: MAX_TCP_CHECK_ITEMS, ...(catalog ? { catalogFetchedAt: catalog.fetchedAt } : {}) });
  }
  if (url.pathname === "/api/ips/check-batch" && request.method === "POST") {
    const stub = probeStub(env);
    const stateResponse = await stub.fetch("https://probe/probe/state");
    const state = await stateResponse.json<{ available: boolean; settingsUpdatedAt?: string; cursor?: number; reachable?: string[]; collected?: CollectedIps }>();
    if (!state.available || !state.collected || state.cursor === undefined) throw new HttpError(404, "检测任务不存在，请重新开始检测");
    if (!isRegionAwareCollected(state.collected)) throw new HttpError(409, "检测任务版本已更新，请重新开始检测");
    const settings = await getSettings(env);
    if (state.settingsUpdatedAt !== settings.updatedAt) throw new HttpError(409, "优选配置已变化，请重新开始检测");
    const requested = state.collected.merged.slice(state.cursor, state.cursor + MAX_TCP_CHECK_ITEMS);
    if (!requested.length) return json({ checkedCount: state.cursor, total: state.collected.merged.length, reachable: state.reachable ?? [], done: true });
    const checked = await checkTcp443Batch(requested);
    const recordResponse = await stub.fetch("https://probe/probe/record", { method: "POST", body: JSON.stringify({ cursor: state.cursor, checkedCount: requested.length, reachable: checked.ips }) });
    const recorded = await recordResponse.json<{ error?: string; cursor?: number; total?: number; reachable?: string[] }>();
    if (!recordResponse.ok) throw new HttpError(recordResponse.status, recorded.error || "检测进度保存失败");
    return json({ checkedCount: recorded.cursor, total: recorded.total, reachable: recorded.reachable, done: recorded.cursor === recorded.total });
  }
  if (url.pathname === "/api/ips/complete" && request.method === "POST") {
    const settings = await getSettings(env);
    const stub = probeStub(env);
    const stateResponse = await stub.fetch("https://probe/probe/state");
    const state = await stateResponse.json<{ available: boolean; settingsUpdatedAt?: string; cursor?: number; reachable?: string[]; collected?: CollectedIps }>();
    if (!state.available || !state.collected || state.cursor === undefined) throw new HttpError(404, "检测任务不存在，请重新开始检测");
    if (!isRegionAwareCollected(state.collected)) throw new HttpError(409, "检测任务版本已更新，请重新开始检测");
    if (state.settingsUpdatedAt !== settings.updatedAt) throw new HttpError(409, "优选配置已变化，请重新开始检测");
    if (state.cursor !== state.collected.merged.length) throw new HttpError(400, "检测尚未覆盖全部候选 IP");
    const collected = { ...state.collected, reachable: dedupeIps(state.reachable ?? []), checkedTcp: true, checkedCount: state.cursor, skippedCount: 0 };
    const snapshot = await savePreferredIpSnapshot(env, settings, collected);
    await stub.fetch("https://probe/probe/clear", { method: "POST" });
    return json({ ...snapshot, expiresAt: new Date(Date.parse(snapshot.checkedAt) + PREFERRED_IP_CACHE_TTL_MS).toISOString() });
  }
  if (url.pathname === "/api/ips/progress" && request.method === "GET") {
    const stateResponse = await probeStub(env).fetch("https://probe/probe/state");
    const state = await stateResponse.json<{ available: boolean; settingsUpdatedAt?: string; cursor?: number; reachable?: string[]; collected?: CollectedIps }>();
    const settings = await getSettings(env);
    if (!state.available || !isRegionAwareCollected(state.collected) || state.settingsUpdatedAt !== settings.updatedAt) return json({ available: false }, 200, { "cache-control": "no-store" });
    return json({ available: true, checkedCount: state.cursor ?? 0, total: state.collected.merged.length, reachable: state.reachable ?? [], collected: state.collected }, 200, { "cache-control": "no-store" });
  }
  if (url.pathname === "/api/cron/status" && request.method === "GET") {
    const response = await cronStub(env).fetch("https://probe/cron/status");
    return json(await response.json(), response.status, { "cache-control": "no-store" });
  }
  if (url.pathname === "/api/cron/run" && request.method === "POST") {
    const response = await cronStub(env).fetch("https://probe/cron/start", { method: "POST" });
    const result = await response.json<{ reason?: string }>();
    if (!response.ok) throw new HttpError(response.status, result.reason === "no-candidates" ? "没有可检测的优选 IP" : "启动定时任务失败");
    return json(result);
  }
  if (url.pathname === "/api/ips/cancel" && request.method === "POST") {
    await probeStub(env).fetch("https://probe/probe/clear", { method: "POST" });
    return json({ ok: true });
  }
  if (url.pathname === "/api/ips/snapshot" && request.method === "GET") {
    const snapshot = await getPreferredIpSnapshot(env, await getSettings(env));
    return json(snapshot ? { available: true, ...snapshot, expiresAt: new Date(Date.parse(snapshot.checkedAt) + PREFERRED_IP_CACHE_TTL_MS).toISOString() } : { available: false }, 200, { "cache-control": "no-store" });
  }
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
