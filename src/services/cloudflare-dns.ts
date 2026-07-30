import { DNS_TTL, MANAGED_COMMENT } from "../config";
import { HttpError } from "../errors";
import { DnsRecord, DnsTarget, Env } from "../types";
import { isIPv4, normalizeDomain } from "../validation";

async function cfFetch<T>(zone: DnsTarget, path: string, init: RequestInit, env: Env, globalApiToken?: string): Promise<T> {
  const token = globalApiToken;
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

function validateRecordInput(zone: DnsTarget, input: Partial<DnsRecord>) {
  const allowedTypes = new Set(["A", "AAAA", "CNAME"]);
  const type = String(input.type ?? "").toUpperCase();
  const name = String(input.name ?? "").trim().toLowerCase();
  const content = String(input.content ?? "").trim();
  if (!allowedTypes.has(type)) throw new HttpError(400, "不支持的 DNS 记录类型");
  const domain = normalizeDomain(zone.domain);
  const allowedNames = new Set([domain, `*.${domain}`]);
  if (!domain || !allowedNames.has(name)) throw new HttpError(400, `记录名称只能是 ${domain} 或 *.${domain}`);
  if (!name || !content) throw new HttpError(400, "记录名称和内容不能为空");
  return { type, name, content, ttl: DNS_TTL, proxied: input.proxied === true, ...(input.priority == null ? {} : { priority: Number(input.priority) }) };
}

async function removeAddressRecords(zone: DnsTarget, name: string, env: Env, globalApiToken?: string, exceptId?: string) {
  const records = await listDnsRecords(zone, env, globalApiToken);
  const addressRecords = records.filter((record) => record.name === name && (record.type === "A" || record.type === "AAAA") && record.id !== exceptId);
  for (const record of addressRecords) {
    await cfFetch<unknown>(zone, `/zones/${zone.zoneId}/dns_records/${encodeURIComponent(record.id)}`, { method: "DELETE" }, env, globalApiToken);
  }
  return addressRecords.length;
}

async function removeCnameRecords(zone: DnsTarget, name: string, env: Env, globalApiToken?: string, exceptId?: string) {
  const records = await listDnsRecords(zone, env, globalApiToken);
  const cnameRecords = records.filter((record) => record.name === name && record.type === "CNAME" && record.id !== exceptId);
  for (const record of cnameRecords) {
    await cfFetch<unknown>(zone, `/zones/${zone.zoneId}/dns_records/${encodeURIComponent(record.id)}`, { method: "DELETE" }, env, globalApiToken);
  }
  return cnameRecords.length;
}

export async function listDnsRecords(zone: DnsTarget, env: Env, globalApiToken?: string) {
  const records: DnsRecord[] = [];
  for (let page = 1; page <= 100; page++) {
    const pageRecords = await cfFetch<DnsRecord[]>(zone, `/zones/${zone.zoneId}/dns_records?per_page=100&page=${page}`, {}, env, globalApiToken);
    records.push(...(pageRecords ?? []));
    if (pageRecords.length < 100) break;
  }
  return records.sort((left, right) => left.name.localeCompare(right.name) || left.type.localeCompare(right.type) || left.content.localeCompare(right.content));
}

export async function createDnsRecord(zone: DnsTarget, input: Partial<DnsRecord>, env: Env, globalApiToken?: string) {
  const validated = validateRecordInput(zone, input);
  if (validated.type === "CNAME") await removeAddressRecords(zone, validated.name, env, globalApiToken);
  else await removeCnameRecords(zone, validated.name, env, globalApiToken);
  return cfFetch<DnsRecord>(zone, `/zones/${zone.zoneId}/dns_records`, { method: "POST", body: JSON.stringify(validated) }, env, globalApiToken);
}

export async function updateDnsRecord(zone: DnsTarget, id: string, input: Partial<DnsRecord>, env: Env, globalApiToken?: string) {
  if (!/^[a-f0-9-]{8,}$/i.test(id)) throw new HttpError(400, "无效的 DNS 记录 ID");
  const validated = validateRecordInput(zone, input);
  if (validated.type === "CNAME") {
    const current = (await listDnsRecords(zone, env, globalApiToken)).find((record) => record.id === id);
    if (!current) throw new HttpError(404, "DNS 记录不存在");
    const currentIsAddress = current.type === "A" || current.type === "AAAA";
    await removeAddressRecords(zone, validated.name, env, globalApiToken, currentIsAddress ? undefined : id);
    if (currentIsAddress) {
      await cfFetch<unknown>(zone, `/zones/${zone.zoneId}/dns_records/${encodeURIComponent(id)}`, { method: "DELETE" }, env, globalApiToken);
      return createDnsRecord(zone, validated, env, globalApiToken);
    }
  } else {
    await removeCnameRecords(zone, validated.name, env, globalApiToken, id);
  }
  return cfFetch<DnsRecord>(zone, `/zones/${zone.zoneId}/dns_records/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(validated) }, env, globalApiToken);
}

export async function deleteDnsRecord(zone: DnsTarget, id: string, env: Env, globalApiToken?: string) {
  if (!/^[a-f0-9-]{8,}$/i.test(id)) throw new HttpError(400, "无效的 DNS 记录 ID");
  await cfFetch<unknown>(zone, `/zones/${zone.zoneId}/dns_records/${encodeURIComponent(id)}`, { method: "DELETE" }, env, globalApiToken);
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
      await cfFetch(zone, `/zones/${zone.zoneId}/dns_records`, { method: "POST", body: JSON.stringify({ type, name, content: ip, ttl: DNS_TTL, proxied: false, comment: MANAGED_COMMENT, tags: [MANAGED_COMMENT] }) }, env, globalApiToken);
      seen.add(key);
      created++;
    }
  }
  return { domain, created, deleted, kept, unproxied, total: ips.length * 2 };
}
