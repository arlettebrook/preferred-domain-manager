import { DNS_TTL, MANAGED_COMMENT } from "../config";
import { HttpError } from "../errors";
import { DnsRecord, DnsTarget, Env } from "../types";
import { detectDnsRecordType, isIPv4, isIPv6, normalizeDomain } from "../validation";
import { cloudflareFetch as cfFetch } from "../integrations/cloudflare/client";

async function listManagedRecords(zone: DnsTarget, env: Env, globalApiToken?: string, source?: DnsRecord[]) {
  const records = source ?? await listDnsRecords(zone, env, globalApiToken);
  return records.filter((record) => record.comment === MANAGED_COMMENT || record.tags?.includes(MANAGED_COMMENT));
}

function validateRecordInput(zone: DnsTarget, input: Partial<DnsRecord>, detectType = false) {
  const allowedTypes = new Set(["A", "AAAA", "CNAME"]);
  const name = String(input.name ?? "").trim().toLowerCase();
  const content = String(input.content ?? "").trim();
  const type = detectType ? detectDnsRecordType(content) : String(input.type ?? "").toUpperCase();
  if (!allowedTypes.has(type)) throw new HttpError(400, "不支持的 DNS 记录类型");
  const domain = normalizeDomain(zone.domain);
  const allowedNames = shouldSyncWildcard(zone) ? [domain] : [domain, `*.${domain}`];
  if (!domain || !allowedNames.includes(name)) throw new HttpError(400, `记录名称只能是 ${allowedNames.join(" 或 ")}`);
  if (!name || !content) throw new HttpError(400, "记录名称和内容不能为空");
  if (type === "A" && !isIPv4(content)) throw new HttpError(400, "A 记录内容必须是有效的 IPv4 地址");
  if (type === "AAAA" && !isIPv6(content)) throw new HttpError(400, "AAAA 记录内容必须是有效的 IPv6 地址");
  if (type === "CNAME" && /\s/.test(content)) throw new HttpError(400, "CNAME 目标不能包含空格");
  return { type, name, content, ttl: DNS_TTL, proxied: false, ...(input.priority == null ? {} : { priority: Number(input.priority) }) };
}

export function isEditableDnsRecord(zone: DnsTarget, record: DnsRecord) {
  const domain = normalizeDomain(zone.domain);
  const allowedNames = shouldSyncWildcard(zone) ? [domain] : [domain, `*.${domain}`];
  return allowedNames.includes(record.name.toLowerCase()) && ["A", "AAAA", "CNAME"].includes(record.type);
}

function pairedName(zone: DnsTarget) {
  return `*.${normalizeDomain(zone.domain)}`;
}

function shouldSyncWildcard(zone: DnsTarget) {
  return zone.syncWildcard !== false;
}

function equivalentDnsContent(left: string, right: string) {
  return left.trim().toLowerCase().replace(/\.$/, "") === right.trim().toLowerCase().replace(/\.$/, "");
}

async function removeConflictingRecords(
  zone: DnsTarget,
  names: string[],
  type: string,
  env: Env,
  globalApiToken?: string,
  exceptIds: string[] = [],
) {
  const records = await listDnsRecords(zone, env, globalApiToken);
  const conflictingTypes = type === "CNAME" ? new Set(["A", "AAAA", "CNAME"]) : new Set(["CNAME"]);
  const removed = records.filter((record) => names.includes(record.name) && conflictingTypes.has(record.type) && !exceptIds.includes(record.id));
  for (const record of removed) {
    await cfFetch<unknown>(zone, `/zones/${zone.zoneId}/dns_records/${encodeURIComponent(record.id)}`, { method: "DELETE" }, env, globalApiToken);
  }
  return removed.length;
}

async function deleteRecord(zone: DnsTarget, id: string, env: Env, globalApiToken?: string) {
  await cfFetch<unknown>(zone, `/zones/${zone.zoneId}/dns_records/${encodeURIComponent(id)}`, { method: "DELETE" }, env, globalApiToken);
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
  const recordsBeforeChange = await listDnsRecords(zone, env, globalApiToken);
  const duplicateRoot = recordsBeforeChange.find((record) => record.name === validated.name && record.type === validated.type && equivalentDnsContent(record.content, validated.content));
  if (duplicateRoot) throw new HttpError(409, `${validated.type} 记录已经存在：${duplicateRoot.content}`);
  const wildcard = pairedName(zone);
  const pairedNames = shouldSyncWildcard(zone) ? [validated.name, wildcard] : [validated.name];
  await removeConflictingRecords(zone, pairedNames, validated.type, env, globalApiToken);
  const existingWildcard = shouldSyncWildcard(zone)
    ? (await listDnsRecords(zone, env, globalApiToken)).find((record) => record.name === wildcard && record.type === validated.type && equivalentDnsContent(record.content, validated.content))
    : undefined;
  const root = await cfFetch<DnsRecord>(zone, `/zones/${zone.zoneId}/dns_records`, { method: "POST", body: JSON.stringify(validated) }, env, globalApiToken);
  if (!shouldSyncWildcard(zone) || existingWildcard) return root;
  try {
    await cfFetch<DnsRecord>(zone, `/zones/${zone.zoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify({ ...validated, name: wildcard }),
    }, env, globalApiToken);
  } catch (error) {
    await deleteRecord(zone, root.id, env, globalApiToken).catch(() => undefined);
    throw error;
  }
  return root;
}

export async function updateDnsRecord(zone: DnsTarget, id: string, input: Partial<DnsRecord>, env: Env, globalApiToken?: string) {
  if (!/^[a-f0-9-]{8,}$/i.test(id)) throw new HttpError(400, "无效的 DNS 记录 ID");
  const current = (await listDnsRecords(zone, env, globalApiToken)).find((record) => record.id === id);
  if (!current) throw new HttpError(404, "DNS 记录不存在");
  if (!isEditableDnsRecord(zone, current)) throw new HttpError(400, "只能编辑主域名或泛域名的 A、AAAA、CNAME 记录");
  const validated = validateRecordInput(zone, input, true);
  const wildcard = pairedName(zone);
  const records = await listDnsRecords(zone, env, globalApiToken);
  const duplicateRoot = records.find((record) => record.id !== id && record.name === validated.name && record.type === validated.type && equivalentDnsContent(record.content, validated.content));
  if (duplicateRoot) throw new HttpError(409, `${validated.type} 记录已经存在：${duplicateRoot.content}`);
  const pairedWildcard = shouldSyncWildcard(zone)
    ? records.find((record) => record.name === wildcard && record.type === current.type && equivalentDnsContent(record.content, current.content))
    : undefined;
  const exceptIds = [id, ...(pairedWildcard ? [pairedWildcard.id] : [])];
  await removeConflictingRecords(zone, shouldSyncWildcard(zone) ? [validated.name, wildcard] : [validated.name], validated.type, env, globalApiToken, exceptIds);

  const updatedRoot = await cfFetch<DnsRecord>(zone, `/zones/${zone.zoneId}/dns_records/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(validated),
  }, env, globalApiToken);
  if (shouldSyncWildcard(zone)) {
    const wildcardInput = { ...validated, name: wildcard };
    if (pairedWildcard) {
      await cfFetch<DnsRecord>(zone, `/zones/${zone.zoneId}/dns_records/${encodeURIComponent(pairedWildcard.id)}`, {
        method: "PUT",
        body: JSON.stringify(wildcardInput),
      }, env, globalApiToken);
    } else {
      await cfFetch<DnsRecord>(zone, `/zones/${zone.zoneId}/dns_records`, { method: "POST", body: JSON.stringify(wildcardInput) }, env, globalApiToken);
    }
  }
  return updatedRoot;
}

export async function deleteDnsRecord(zone: DnsTarget, id: string, env: Env, globalApiToken?: string) {
  if (!/^[a-f0-9-]{8,}$/i.test(id)) throw new HttpError(400, "无效的 DNS 记录 ID");
  const current = (await listDnsRecords(zone, env, globalApiToken)).find((record) => record.id === id);
  if (!current) throw new HttpError(404, "DNS 记录不存在");
  if (!isEditableDnsRecord(zone, current)) throw new HttpError(400, "只能删除主域名或泛域名的 A、AAAA、CNAME 记录");
  const wildcard = pairedName(zone);
  const records = await listDnsRecords(zone, env, globalApiToken);
  const pairedWildcard = shouldSyncWildcard(zone)
    ? records.find((record) => record.name === wildcard && record.type === current.type && equivalentDnsContent(record.content, current.content))
    : undefined;
  await deleteRecord(zone, id, env, globalApiToken);
  if (pairedWildcard) await deleteRecord(zone, pairedWildcard.id, env, globalApiToken);
}

export async function syncZone(zone: DnsTarget, ips: string[], env: Env, globalApiToken?: string) {
  const domain = normalizeDomain(zone.domain);
  if (!domain || !zone.zoneId) throw new HttpError(400, "缺少默认域名或 Zone ID");
  const names = new Set([domain, `*.${domain}`]);
  const allRecords = await listDnsRecords(zone, env, globalApiToken);
  const cnameNames = new Set(allRecords.filter((record) => names.has(record.name) && record.type === "CNAME").map((record) => record.name));
  const hasPairedCname = cnameNames.size > 0;
  const namesToSync = shouldSyncWildcard(zone) && hasPairedCname
    ? new Set<string>()
    : new Set([...names].filter((name) => !cnameNames.has(name)));
  const existing = (await listManagedRecords(zone, env, globalApiToken, allRecords)).filter((record) => names.has(record.name) && (record.type === "A" || record.type === "AAAA"));
  const desired = new Map<string, Set<string>>();
  for (const name of namesToSync) desired.set(name, new Set(ips.map((ip) => `${isIPv4(ip) ? "A" : "AAAA"}:${ip}`)));
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

  for (const name of namesToSync) {
    for (const ip of ips) {
      const type = isIPv4(ip) ? "A" : "AAAA";
      const key = `${name}:${type}:${ip}`;
      if (seen.has(key)) continue;
      await cfFetch(zone, `/zones/${zone.zoneId}/dns_records`, { method: "POST", body: JSON.stringify({ type, name, content: ip, ttl: DNS_TTL, proxied: false, comment: MANAGED_COMMENT, tags: [MANAGED_COMMENT] }) }, env, globalApiToken);
      seen.add(key);
      created++;
    }
  }
  return { domain, created, deleted, kept, unproxied, total: ips.length * namesToSync.size, skippedCname: hasPairedCname };
}
