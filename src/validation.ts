export function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\*\./, "");
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

