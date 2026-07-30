import { SETTINGS_KEY } from "./config";
import { createSession, expiredCookie, isValidSession, sessionCookie } from "./security/session";
import { collectPreferredIps } from "./services/ip-sources";
import { getSettings, publicSettings } from "./services/settings";
import { runSync } from "./services/sync";
import { Env, IpSource, Settings } from "./types";
import { dedupeIps, normalizeDomain } from "./validation";
import { LockBusyError, HttpError } from "./errors";
import { json, readJson } from "./http";

async function requireAuth(request: Request, env: Env) {
  if (!(await isValidSession(request, env))) throw new HttpError(401, "未登录或登录已过期");
}

async function saveConfig(request: Request, env: Env) {
  const input = await readJson<{
    ipSources?: Array<Partial<IpSource>>;
    manualIps?: string[];
    defaultDomain?: string;
    cfZoneId?: string;
    cfApiToken?: string;
  }>(request);
  const previous = await getSettings(env);
  const ipSources = (input.ipSources ?? []).map((source) => ({
    id: String(source.id || crypto.randomUUID()),
    url: String(source.url || "").trim(),
    enabled: source.enabled !== false,
  })).filter((source) => /^https?:\/\//i.test(source.url));
  const settings: Settings = {
    ipSources,
    manualIps: dedupeIps((input.manualIps ?? []).flatMap((item) => String(item).split(/[\s,]+/))),
    defaultDomain: normalizeDomain(String(input.defaultDomain || "")),
    cfZoneId: String(input.cfZoneId || "").trim(),
    cfApiToken: typeof input.cfApiToken === "string" && input.cfApiToken ? input.cfApiToken : previous.cfApiToken,
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
  await requireAuth(request, env);

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
