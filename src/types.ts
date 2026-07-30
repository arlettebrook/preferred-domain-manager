export interface Env {
  PDM_KV: KVNamespace;
  SYNC_LOCK: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  CF_API_TOKEN?: string;
  DEFAULT_DOMAIN?: string;
  CF_ZONE_ID?: string;
  IP_SOURCES?: string;
}

export interface ZoneConfig {
  id: string;
  name: string;
  zoneId: string;
  domain: string;
  apiToken?: string;
}

export interface IpSource {
  id: string;
  url: string;
  enabled: boolean;
}

export interface Settings {
  zones: ZoneConfig[];
  ipSources: IpSource[];
  manualIps: string[];
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

