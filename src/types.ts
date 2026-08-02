export interface Env {
  PDM_KV: KVNamespace;
  SYNC_LOCK: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
}

export interface DnsTarget {
  zoneId: string;
  domain: string;
  syncWildcard?: boolean;
}

export interface IpSource {
  id: string;
  url: string;
  enabled: boolean;
  note?: string;
}

export interface DomainProfile {
  id: string;
  domain: string;
  zoneId: string;
  syncWildcard?: boolean;
  apiToken?: string;
  hasApiToken?: boolean;
}

export interface Settings {
  ipSources: IpSource[];
  manualIps: string[];
  domains?: DomainProfile[];
  adminPath?: string;
  cfApiToken?: string;
  defaultDomain?: string;
  cfZoneId?: string;
  telegramBotToken?: string;
  telegramAllowedUserIds?: string[];
  telegramWebhookSecret?: string;
  updatedAt: string;
}

export interface DnsRecord {
  id: string;
  type: "A" | "AAAA" | string;
  name: string;
  content: string;
  proxied?: boolean;
  comment?: string | null;
  tags?: string[];
  ttl?: number;
  priority?: number | null;
  data?: Record<string, unknown>;
  editable?: boolean;
}

export interface SourceResult {
  source: IpSource;
  ips: string[];
  error?: string;
}

export interface CollectedIps {
  checkedTcp: boolean;
  checkedCount: number;
  skippedCount: number;
  sourceIps: string[];
  merged: string[];
  reachable: string[];
  sources: Array<{ id: string; url: string; enabled: boolean; count: number; note?: string; error?: string }>;
}

export interface PreferredIpSnapshot {
  settingsUpdatedAt: string;
  checkedAt: string;
  collected: CollectedIps;
}
