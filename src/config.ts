export const SETTINGS_KEY = "settings";
export const SESSION_COOKIE = "pdm_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const MANAGED_COMMENT = "preferred-domain-manager";
const CRON_INTERVAL_MINUTES = 30;
export const CRON_CONFIG = {
  schedule: `*/${CRON_INTERVAL_MINUTES} * * * *`,
  intervalMinutes: CRON_INTERVAL_MINUTES,
  intervalLabel: `${CRON_INTERVAL_MINUTES} 分钟`,
  intervalMs: CRON_INTERVAL_MINUTES * 60 * 1000,
  defaultEnabled: true,
  stateVersion: 1,
  durableObjectName: "preferred-ip-cron",
  storageKey: "cronConfig",
  lastResultStorageKey: "lastCronResult",
  probeStorageKey: "probe",
  alarmDelayMs: 1000,
  busyRetryDelayMs: 5000,
  routes: {
    config: "/cron/config",
    start: "/cron/start",
    status: "/cron/status",
    cancel: "/cron/cancel",
  },
  apiRoutes: {
    config: "/api/cron/config",
    status: "/api/cron/status",
    run: "/api/cron/run",
  },
} as const;
export const MAX_SOURCE_ITEMS = 500;
export const MAX_IP_SOURCE_COUNT = 5;
// Per-request probe batch. The UI drains all candidates across multiple
// requests so every IP is checked without concentrating sockets in one Worker.
export const MAX_TCP_CHECK_ITEMS = 20;
// Cloudflare Workers allows at most six simultaneous outgoing connections.
// Keep one slot in reserve for runtime/network overhead.
export const TCP_CHECK_CONCURRENCY = 5;
export const TCP_CHECK_TIMEOUT_MS = 3000;
export const PREFERRED_IP_CACHE_KEY = "preferred-ips";
export const PREFERRED_IP_CACHE_TTL_MS = 15 * 60 * 1000;
export const REGION_CATALOG_CACHE_KEY = "preferred-ip-regions";
export const SYNC_LOCK_NAME = "global";
// Cloudflare DNS-only records accept 60 seconds on standard plans.
export const DNS_TTL = 60;
