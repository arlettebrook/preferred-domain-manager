import { SETTINGS_KEY } from "../config";
import { Env, Settings } from "../types";
import { normalizeDomain } from "../validation";

export function defaultSettings(env: Env): Settings {
  const domain = normalizeDomain(env.DEFAULT_DOMAIN ?? "");
  const zones = domain && env.CF_ZONE_ID ? [{ id: crypto.randomUUID(), name: domain, zoneId: env.CF_ZONE_ID, domain }] : [];
  const sourceValues = (env.IP_SOURCES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return {
    zones,
    ipSources: sourceValues.map((url) => ({ id: crypto.randomUUID(), url, enabled: true })),
    manualIps: [],
    updatedAt: new Date().toISOString(),
  };
}

export async function getSettings(env: Env): Promise<Settings> {
  const saved = await env.PDM_KV.get<Settings>(SETTINGS_KEY, "json");
  if (saved?.zones && saved?.ipSources && saved?.manualIps) return saved;
  const initial = defaultSettings(env);
  await env.PDM_KV.put(SETTINGS_KEY, JSON.stringify(initial));
  return initial;
}

export function publicSettings(settings: Settings) {
  return {
    zones: settings.zones.map(({ apiToken, ...zone }) => ({ ...zone, hasToken: Boolean(apiToken) })),
    ipSources: settings.ipSources,
    manualIps: settings.manualIps,
    updatedAt: settings.updatedAt,
  };
}

