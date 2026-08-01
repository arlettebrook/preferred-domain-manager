export const SETTINGS_KEY = "settings";
export const SESSION_COOKIE = "pdm_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const MANAGED_COMMENT = "preferred-domain-manager";
export const MAX_SOURCE_ITEMS = 500;
export const MAX_IP_SOURCE_COUNT = 5;
// Keep one probe request well below the Workers subrequest budget. DNS sync
// uses the cached result from the preview step and never opens these sockets.
export const MAX_TCP_CHECK_ITEMS = 20;
export const TCP_CHECK_CONCURRENCY = 8;
export const TCP_CHECK_TIMEOUT_MS = 3000;
export const PREFERRED_IP_CACHE_KEY = "preferred-ips";
export const PREFERRED_IP_CACHE_TTL_MS = 15 * 60 * 1000;
export const SYNC_LOCK_NAME = "global";
// Cloudflare DNS-only records accept 60 seconds on standard plans.
export const DNS_TTL = 60;
