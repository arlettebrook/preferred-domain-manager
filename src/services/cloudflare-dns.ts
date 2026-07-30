import { MANAGED_COMMENT } from "../config";
import { HttpError } from "../errors";
import { DnsRecord, DnsTarget, Env } from "../types";
import { isIPv4, normalizeDomain } from "../validation";

async function cfFetch<T>(zone: DnsTarget, path: string, init: RequestInit, env: Env, globalApiToken?: string): Promise<T> {
  const token = globalApiToken || env.CF_API_TOKEN;
  if (!token) throw new HttpError(400, "没有配置 Cloudflare API Token");
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.json<{ success: boolean; result: T; errors?: Array<{ message?: string }> }>();
  if (!response.ok || !body.success) throw new HttpError(response.status || 502, body.errors?.map((error) => error.message).join("; ") || "Cloudflare API 请求失败");
  return body.result;
}

async function listManagedRecords(zone: DnsTarget, env: Env, globalApiToken?: string) {
  const records: DnsRecord[] = [];
  for (let page = 1; page <= 100; page++) {
    const pageRecords = await cfFetch<DnsRecord[]>(zone, `/zones/${zone.zoneId}/dns_records?per_page=100&page=${page}`, {}, env, globalApiToken);
    records.push(...(pageRecords ?? []));
    if (pageRecords.length < 100) break;
  }
  return records.filter((record) => record.comment === MANAGED_COMMENT || record.tags?.includes(MANAGED_COMMENT));
}

export async function syncZone(zone: DnsTarget, ips: string[], env: Env, globalApiToken?: string) {
  const domain = normalizeDomain(zone.domain);
  if (!domain || !zone.zoneId) throw new HttpError(400, "缺少默认域名或 Zone ID");
  const names = new Set([domain, `*.${domain}`]);
  const existing = (await listManagedRecords(zone, env, globalApiToken)).filter((record) => names.has(record.name) && (record.type === "A" || record.type === "AAAA"));
  const desired = new Map<string, Set<string>>();
  for (const name of names) desired.set(name, new Set(ips.map((ip) => `${isIPv4(ip) ? "A" : "AAAA"}:${ip}`)));
  let created = 0, deleted = 0, kept = 0, unproxied = 0;
  const seen = new Set<string>();

  for (const record of existing) {
    const key = `${record.type}:${record.content}`;
    const desiredForName = desired.get(record.name) ?? new Set<string>();
    if (!desiredForName.has(key) || seen.has(`${record.name}:${key}`)) {
      await cfFetch(zone, `/zones/${zone.zoneId}/dns_records/${record.id}`, { method: "DELETE" }, env, globalApiToken);
      deleted++;
      continue;
    }
    seen.add(`${record.name}:${key}`);
    if (record.proxied) {
      await cfFetch(zone, `/zones/${zone.zoneId}/dns_records/${record.id}`, { method: "PATCH", body: JSON.stringify({ proxied: false, comment: MANAGED_COMMENT }) }, env, globalApiToken);
      unproxied++;
    } else kept++;
  }

  for (const name of names) {
    for (const ip of ips) {
      const type = isIPv4(ip) ? "A" : "AAAA";
      const key = `${name}:${type}:${ip}`;
      if (seen.has(key)) continue;
      await cfFetch(zone, `/zones/${zone.zoneId}/dns_records`, { method: "POST", body: JSON.stringify({ type, name, content: ip, ttl: 60, proxied: false, comment: MANAGED_COMMENT, tags: [MANAGED_COMMENT] }) }, env, globalApiToken);
      seen.add(key);
      created++;
    }
  }
  return { domain, created, deleted, kept, unproxied, total: ips.length * 2 };
}
