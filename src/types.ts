export interface Env {
  PDM_KV: KVNamespace;
  SYNC_LOCK: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
}

export interface DnsTarget {
  zoneId: string;
  domain: string;
}

export interface IpSource {
  id: string;
  url: string;
  enabled: boolean;
}

export interface Settings {
  ipSources: IpSource[];
  manualIps: string[];
  cfApiToken?: string;
  defaultDomain?: string;
  cfZoneId?: string;
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
