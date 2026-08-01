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

export type DnsHistoryAction = "create" | "update" | "delete" | "rollback";

export interface DnsHistoryRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  comment?: string | null;
  tags?: string[];
  priority?: number | null;
}

export interface DnsHistoryEntry {
  id: string;
  at: string;
  action: DnsHistoryAction;
  domain: string;
  summary: string;
  before: DnsHistoryRecord[];
  after: DnsHistoryRecord[];
}

export interface SourceResult {
  source: IpSource;
  ips: string[];
  error?: string;
}

export interface CollectedIps {
  merged: string[];
  reachable: string[];
  sources: Array<{ id: string; url: string; count: number; error?: string }>;
}

export interface SyncState {
  at: string;
  ok: boolean;
  candidates: number;
  reachable: number;
  domains: number;
  failed: number;
}
