import { openApiDocument } from "./openapi";
import { SETTINGS_KEY } from "./config";
import { createSession, expiredCookie, isValidSession, sessionCookie } from "./security/session";
import { collectPreferredIps } from "./services/ip-sources";
import { getSettings, publicSettings } from "./services/settings";
import { runSync } from "./services/sync";
import { Env, IpSource, ZoneConfig } from "./types";
import { dedupeIps, normalizeDomain } from "./validation";
import { LockBusyError, HttpError } from "./errors";
import { json, readJson } from "./http";

async function requireAuth(request: Request, env: Env) {
  if (!(await isValidSession(request, env))) throw new HttpError(401, "未登录或登录已过期");
}

async function saveConfig(request: Request, env: Env) {
  const input = await readJson<{
    zones?: Array<Partial<ZoneConfig> & { hasToken?: boolean }>;
    ipSources?: Array<Partial<IpSource>>;
    manualIps?: string[];
  }>(request);
  const previous = await getSettings(env);
  const zones = (input.zones ?? []).map((zone, index) => {
    const old = previous.zones.find((item) => item.id === zone.id);
    return {
      id: String(zone.id || crypto.randomUUID()),
      name: String(zone.name || `Zone ${index + 1}`).trim(),
      zoneId: String(zone.zoneId || "").trim(),
      domain: normalizeDomain(String(zone.domain || "")),
      apiToken: typeof zone.apiToken === "string" && zone.apiToken ? zone.apiToken : old?.apiToken,
    };
  }).filter((zone) => zone.domain && zone.zoneId);
  const ipSources = (input.ipSources ?? []).map((source) => ({
    id: String(source.id || crypto.randomUUID()),
    url: String(source.url || "").trim(),
    enabled: source.enabled !== false,
  })).filter((source) => /^https?:\/\//i.test(source.url));
  const settings = {
    zones,
    ipSources,
    manualIps: dedupeIps((input.manualIps ?? []).flatMap((item) => String(item).split(/[\s,]+/))),
    updatedAt: new Date().toISOString(),
  };
  await env.PDM_KV.put(SETTINGS_KEY, JSON.stringify(settings));
  return json(publicSettings(settings));
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
  if (url.pathname === "/api/openapi.json") return json(openApiDocument);
  await requireAuth(request, env);

  if (url.pathname === "/api/auth/me") return json({ authenticated: true });
  if (url.pathname === "/api/config" && request.method === "GET") return json(publicSettings(await getSettings(env)));
  if (url.pathname === "/api/config" && request.method === "PUT") return saveConfig(request, env);
  if (url.pathname === "/api/ips/preview" && request.method === "POST") return json(await collectPreferredIps(await getSettings(env), true));
  if (url.pathname === "/api/sync" && request.method === "POST") {
    try {
      const body = await readJson<{ zoneId?: string }>(request);
      return json({ ok: true, ...(await runSync(env, body.zoneId)) });
    } catch (error) {
      if (error instanceof LockBusyError) return json({ ok: false, error: error.message }, 409);
      throw error;
    }
  }
  throw new HttpError(404, "接口不存在");
}
