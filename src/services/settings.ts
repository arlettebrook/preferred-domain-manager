import { SETTINGS_KEY } from "../config";
import { DnsTarget, Env, Settings } from "../types";
import { normalizeDomain } from "../validation";

export function defaultSettings(env: Env): Settings {
  const domain = normalizeDomain(env.DEFAULT_DOMAIN ?? "");
  const sourceValues = (env.IP_SOURCES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return {
    ipSources: sourceValues.map((url) => ({ id: crypto.randomUUID(), url, enabled: true })),
    manualIps: [],
    cfApiToken: env.CF_API_TOKEN,
    defaultDomain: domain,
    cfZoneId: env.CF_ZONE_ID,
    updatedAt: new Date().toISOString(),
  };
}

export async function getSettings(env: Env): Promise<Settings> {
  const saved = await env.PDM_KV.get<Settings>(SETTINGS_KEY, "json");
  if (saved?.ipSources && saved?.manualIps) {
    const legacyZone = (saved as Settings & { zones?: Array<{ domain?: string; zoneId?: string; apiToken?: string }> }).zones?.[0];
    return {
      ...saved,
      defaultDomain: saved.defaultDomain ?? legacyZone?.domain ?? env.DEFAULT_DOMAIN,
      cfZoneId: saved.cfZoneId ?? legacyZone?.zoneId ?? env.CF_ZONE_ID,
      cfApiToken: saved.cfApiToken ?? legacyZone?.apiToken ?? env.CF_API_TOKEN,
    };
  }
  const initial = defaultSettings(env);
  await env.PDM_KV.put(SETTINGS_KEY, JSON.stringify(initial));
  return initial;
}

export function publicSettings(settings: Settings) {
  return {
    ipSources: settings.ipSources,
    manualIps: settings.manualIps,
    defaultDomain: settings.defaultDomain ?? "",
    cfZoneId: settings.cfZoneId ?? "",
    hasCfApiToken: Boolean(settings.cfApiToken),
    updatedAt: settings.updatedAt,
  };
}

export function effectiveTarget(settings: Settings): DnsTarget | undefined {
  if (!settings.defaultDomain || !settings.cfZoneId) return undefined;
  return { zoneId: settings.cfZoneId, domain: settings.defaultDomain };
}
