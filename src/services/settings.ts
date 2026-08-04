import { SETTINGS_KEY } from "../config";
import { DomainProfile, DnsTarget, Env, Settings } from "../types";
import { DEFAULT_ADMIN_PATH, isValidAdminPath, isValidHomeRedirectUrl, normalizeAdminPath, normalizeDomain } from "../validation";

function profileId(domain: string) {
  return `domain:${domain}`;
}

function isWildcardSyncEnabled(value: unknown) {
  if (typeof value === "string") return !["false", "0", "off", "no"].includes(value.trim().toLowerCase());
  return value !== false && value !== 0;
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
      autoSyncEnabled: item.autoSyncEnabled === true,
      // Existing profiles used implicit wildcard synchronization. Keep that behavior for migrated data.
      syncWildcard: isWildcardSyncEnabled(item.syncWildcard),
      ...(apiToken ? { apiToken } : {}),
    });
  }
  return profiles;
}

export function domainProfiles(settings: Pick<Settings, "domains" | "defaultDomain" | "cfZoneId" | "cfApiToken">) {
  const configured = Array.isArray(settings.domains) ? settings.domains : [];
  if (configured.length) return normalizeDomainProfiles(configured);
  if (settings.defaultDomain && settings.cfZoneId) {
    return normalizeDomainProfiles([{ id: profileId(settings.defaultDomain), domain: settings.defaultDomain, zoneId: settings.cfZoneId, autoSyncEnabled: false, syncWildcard: true, apiToken: settings.cfApiToken }]);
  }
  return [];
}

export function effectiveAdminPath(settings: Pick<Settings, "adminPath">) {
  const normalized = normalizeAdminPath(settings.adminPath || DEFAULT_ADMIN_PATH);
  return isValidAdminPath(normalized) ? normalized : DEFAULT_ADMIN_PATH;
}

export function effectiveHomeRedirect(settings: Pick<Settings, "homeRedirectEnabled" | "homeRedirectUrl">) {
  const target = String(settings.homeRedirectUrl || "").trim();
  return settings.homeRedirectEnabled === true && isValidHomeRedirectUrl(target) ? target : "";
}

export function defaultSettings(): Settings {
  return {
    ipSources: [],
    manualIps: [],
    preferredRegions: undefined,
    domains: [],
    adminPath: DEFAULT_ADMIN_PATH,
    homeRedirectEnabled: false,
    homeRedirectUrl: "",
    cfApiToken: undefined,
    defaultDomain: "",
    cfZoneId: "",
    telegramBotToken: undefined,
    telegramAllowedUserIds: [],
    telegramWebhookSecret: undefined,
    cronEnabled: true,
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
      preferredRegions: Array.isArray(saved.preferredRegions) && saved.preferredRegions.length ? saved.preferredRegions : undefined,
      adminPath: effectiveAdminPath(saved),
      homeRedirectEnabled: saved.homeRedirectEnabled === true,
      homeRedirectUrl: String(saved.homeRedirectUrl || "").trim(),
      defaultDomain: active?.domain ?? saved.defaultDomain ?? legacyZone?.domain ?? "",
      cfZoneId: active?.zoneId ?? saved.cfZoneId ?? legacyZone?.zoneId ?? "",
      cfApiToken: saved.cfApiToken ?? legacyZone?.apiToken,
      telegramAllowedUserIds: saved.telegramAllowedUserIds ?? [],
      cronEnabled: saved.cronEnabled !== false,
    };
  }
  const initial = defaultSettings();
  await env.PDM_KV.put(SETTINGS_KEY, JSON.stringify(initial));
  return initial;
}

export function publicSettings(settings: Settings) {
  const profiles = domainProfiles(settings);
  const activeDomain = profiles.find((profile) => profile.domain === settings.defaultDomain) || profiles[0];
  return {
    ipSources: settings.ipSources,
    manualIps: settings.manualIps,
    preferredRegions: settings.preferredRegions ?? null,
    domains: profiles.map(({ apiToken: _apiToken, ...profile }) => ({ ...profile, hasApiToken: Boolean(_apiToken) })),
    activeDomainId: activeDomain?.id || "",
    adminPath: effectiveAdminPath(settings),
    homeRedirectEnabled: settings.homeRedirectEnabled === true,
    homeRedirectUrl: String(settings.homeRedirectUrl || "").trim(),
    defaultDomain: settings.defaultDomain ?? "",
    cfZoneId: settings.cfZoneId ?? "",
    hasCfApiToken: Boolean(effectiveApiToken(settings)),
    telegramAllowedUserIds: settings.telegramAllowedUserIds ?? [],
    hasTelegramBotToken: Boolean(settings.telegramBotToken),
    hasTelegramWebhookSecret: Boolean(settings.telegramWebhookSecret),
    cronEnabled: settings.cronEnabled !== false,
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
