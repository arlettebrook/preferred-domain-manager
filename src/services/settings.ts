import { SETTINGS_KEY } from "../config";
import { DomainProfile, DnsTarget, Env, Settings } from "../types";
import { DEFAULT_ADMIN_PATH, isValidAdminPath, normalizeAdminPath, normalizeDomain } from "../validation";

function profileId(domain: string) {
  return `domain:${domain}`;
}

function normalizeDomainProfiles(values: unknown[]): DomainProfile[] {
  const seen = new Set<string>();
  const ids = new Set<string>();
  const profiles: DomainProfile[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const item = value as Partial<DomainProfile>;
    const domain = normalizeDomain(String(item.domain || ""));
    const zoneId = String(item.zoneId || "").trim();
    const apiToken = typeof item.apiToken === "string" && item.apiToken ? item.apiToken : undefined;
    if (!domain || !zoneId || seen.has(domain)) continue;
    let id = String(item.id || profileId(domain)).trim() || profileId(domain);
    if (ids.has(id)) id = profileId(domain);
    seen.add(domain);
    ids.add(id);
    profiles.push({
      id,
      domain,
      zoneId,
      // Existing profiles used implicit wildcard synchronization. Keep that behavior for migrated data.
      syncWildcard: item.syncWildcard !== false,
      ...(apiToken ? { apiToken } : {}),
    });
  }
  return profiles;
}

export function domainProfiles(settings: Pick<Settings, "domains" | "defaultDomain" | "cfZoneId" | "cfApiToken">) {
  const configured = Array.isArray(settings.domains) ? settings.domains : [];
  if (configured.length) return normalizeDomainProfiles(configured);
  if (settings.defaultDomain && settings.cfZoneId) {
    return normalizeDomainProfiles([{ id: profileId(settings.defaultDomain), domain: settings.defaultDomain, zoneId: settings.cfZoneId, syncWildcard: true, apiToken: settings.cfApiToken }]);
  }
  return [];
}

export function effectiveAdminPath(settings: Pick<Settings, "adminPath">) {
  const normalized = normalizeAdminPath(settings.adminPath || DEFAULT_ADMIN_PATH);
  return isValidAdminPath(normalized) ? normalized : DEFAULT_ADMIN_PATH;
}

export function defaultSettings(): Settings {
  return {
    ipSources: [],
    manualIps: [],
    domains: [],
    adminPath: DEFAULT_ADMIN_PATH,
    cfApiToken: undefined,
    defaultDomain: "",
    cfZoneId: "",
    telegramBotToken: undefined,
    telegramAllowedUserIds: [],
    telegramWebhookSecret: undefined,
    updatedAt: new Date().toISOString(),
  };
}

export async function getSettings(env: Env): Promise<Settings> {
  const saved = await env.PDM_KV.get<Settings>(SETTINGS_KEY, "json");
  if (saved?.ipSources && saved?.manualIps) {
    const legacyZone = (saved as Settings & { zones?: Array<{ domain?: string; zoneId?: string; apiToken?: string }> }).zones?.[0];
    const domains = domainProfiles({
      domains: saved.domains,
      defaultDomain: saved.defaultDomain ?? legacyZone?.domain ?? "",
      cfZoneId: saved.cfZoneId ?? legacyZone?.zoneId ?? "",
      cfApiToken: saved.cfApiToken ?? legacyZone?.apiToken,
    });
    const active = domains.find((item) => item.domain === String(saved.defaultDomain || legacyZone?.domain || "").trim().toLowerCase()) || domains[0];
    return {
      ...saved,
      domains,
      adminPath: effectiveAdminPath(saved),
      defaultDomain: active?.domain ?? saved.defaultDomain ?? legacyZone?.domain ?? "",
      cfZoneId: active?.zoneId ?? saved.cfZoneId ?? legacyZone?.zoneId ?? "",
      cfApiToken: saved.cfApiToken ?? legacyZone?.apiToken,
      telegramAllowedUserIds: saved.telegramAllowedUserIds ?? [],
    };
  }
  const initial = defaultSettings();
  await env.PDM_KV.put(SETTINGS_KEY, JSON.stringify(initial));
  return initial;
}

export function publicSettings(settings: Settings) {
  return {
    ipSources: settings.ipSources,
    manualIps: settings.manualIps,
    domains: domainProfiles(settings).map(({ apiToken: _apiToken, ...profile }) => ({ ...profile, hasApiToken: Boolean(_apiToken) })),
    adminPath: effectiveAdminPath(settings),
    defaultDomain: settings.defaultDomain ?? "",
    cfZoneId: settings.cfZoneId ?? "",
    hasCfApiToken: Boolean(effectiveApiToken(settings)),
    telegramAllowedUserIds: settings.telegramAllowedUserIds ?? [],
    hasTelegramBotToken: Boolean(settings.telegramBotToken),
    hasTelegramWebhookSecret: Boolean(settings.telegramWebhookSecret),
    updatedAt: settings.updatedAt,
  };
}

export function effectiveTarget(settings: Settings, domainId?: string): DnsTarget | undefined {
  const profiles = domainProfiles(settings);
  const profile = domainId ? profiles.find((item) => item.id === domainId) : profiles.find((item) => item.domain === settings.defaultDomain) || profiles[0];
  if (profile) return { zoneId: profile.zoneId, domain: profile.domain, syncWildcard: profile.syncWildcard !== false };
  if (domainId) return undefined;
  if (!settings.defaultDomain || !settings.cfZoneId) return undefined;
  return { zoneId: settings.cfZoneId, domain: settings.defaultDomain, syncWildcard: true };
}

export function effectiveApiToken(settings: Settings, domainId?: string) {
  const profiles = domainProfiles(settings);
  const profile = domainId ? profiles.find((item) => item.id === domainId) : profiles.find((item) => item.domain === settings.defaultDomain) || profiles[0];
  return profile?.apiToken;
}
