import { SETTINGS_KEY } from "../config";
import { DnsTarget, Env, Settings } from "../types";
import { DEFAULT_ADMIN_PATH, isValidAdminPath, normalizeAdminPath } from "../validation";

export function defaultSettings(): Settings {
  return {
    ipSources: [],
    manualIps: [],
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
    return {
      ...saved,
      adminPath: saved.adminPath && isValidAdminPath(normalizeAdminPath(saved.adminPath)) ? normalizeAdminPath(saved.adminPath) : DEFAULT_ADMIN_PATH,
      defaultDomain: saved.defaultDomain ?? legacyZone?.domain ?? "",
      cfZoneId: saved.cfZoneId ?? legacyZone?.zoneId ?? "",
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
    adminPath: settings.adminPath && isValidAdminPath(normalizeAdminPath(settings.adminPath)) ? normalizeAdminPath(settings.adminPath) : DEFAULT_ADMIN_PATH,
    defaultDomain: settings.defaultDomain ?? "",
    cfZoneId: settings.cfZoneId ?? "",
    hasCfApiToken: Boolean(settings.cfApiToken),
    telegramAllowedUserIds: settings.telegramAllowedUserIds ?? [],
    hasTelegramBotToken: Boolean(settings.telegramBotToken),
    hasTelegramWebhookSecret: Boolean(settings.telegramWebhookSecret),
    updatedAt: settings.updatedAt,
  };
}

export function effectiveTarget(settings: Settings): DnsTarget | undefined {
  if (!settings.defaultDomain || !settings.cfZoneId) return undefined;
  return { zoneId: settings.cfZoneId, domain: settings.defaultDomain };
}
