export function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\*\./, "");
}

export const DEFAULT_ADMIN_PATH = "/admin";

export function normalizeHomeRedirectUrl(value: string) {
  return value.trim();
}

export function isValidHomeRedirectUrl(value: string) {
  if (!value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function normalizeAdminPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_ADMIN_PATH;
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

export function isValidAdminPath(value: string) {
  return value !== "/"
    && value.length <= 80
    && /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value)
    && value !== "/api"
    && !value.startsWith("/api/")
    && value !== "/telegram"
    && !value.startsWith("/telegram/");
}

export function normalizeIp(value: string) {
  return value.trim().replace(/^\[|\]$/g, "").toLowerCase();
}

export function isIPv4(value: string) {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^(0|[1-9]\d*)$/.test(part) && Number(part) <= 255);
}

export function isIPv6(value: string) {
  if (!value.includes(":")) return false;
  const clean = value.split("%", 1)[0];
  if (!/^[0-9a-f:]+$/i.test(clean)) return false;
  const double = clean.indexOf("::");
  if (double !== -1 && clean.indexOf("::", double + 2) !== -1) return false;
  const groups = clean.split(":").filter(Boolean);
  if (groups.some((group) => group.length > 4)) return false;
  return double !== -1 ? groups.length < 8 : groups.length === 8;
}

export type DnsRecordType = "A" | "AAAA" | "CNAME";

export function detectDnsRecordType(value: string): DnsRecordType {
  const content = value.trim();
  if (isIPv4(content)) return "A";
  if (isIPv6(content)) return "AAAA";
  return "CNAME";
}

export function validIp(value: string) {
  const ip = normalizeIp(value);
  return isIPv4(ip) || isIPv6(ip);
}

export function dedupeIps(values: string[]) {
  return [...new Set(values.map(normalizeIp).filter(validIp))];
}

export function escapeHtml(value: string) {
  const replacements: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (character) => replacements[character] ?? character);
}
