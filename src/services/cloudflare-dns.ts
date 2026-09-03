import { DNS_TTL, MANAGED_COMMENT } from "../config";
import { HttpError } from "../errors";
import { DnsRecord, DnsTarget, Env } from "../types";
import { detectDnsRecordType, isIPv4, isIPv6, normalizeDomain } from "../validation";
import { cloudflareFetch as cfFetch } from "../integrations/cloudflare/client";

function normalizeRecordName(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\.$/, "");
}

function sameRecordName(left: unknown, right: unknown) {
  return normalizeRecordName(left) === normalizeRecordName(right);
}

function isManagedRecord(record: DnsRecord) {
  return record.comment === MANAGED_COMMENT || record.tags?.includes(MANAGED_COMMENT);
}

function validateRecordInput(zone: DnsTarget, input: Partial<DnsRecord>, detectType = false) {
  const allowedTypes = new Set(["A", "AAAA", "CNAME"]);
  const name = normalizeRecordName(input.name);
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
  return allowedNames.includes(normalizeRecordName(record.name)) && ["A", "AAAA", "CNAME"].includes(record.type);
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

function sortDnsRecords(records: DnsRecord[]) {
  return records.sort((left, right) => left.name.localeCompare(right.name) || left.type.localeCompare(right.type) || left.content.localeCompare(right.content));
}

async function listDnsRecordsByNames(zone: DnsTarget, names: Set<string>, env: Env, globalApiToken?: string) {
  const records = (await Promise.all([...names].map(async (name) => {
    const result = await cfFetch<DnsRecord[] | undefined>(zone, `/zones/${zone.zoneId}/dns_records?name=${encodeURIComponent(name)}&per_page=1000`, {}, env, globalApiToken);
    return result ?? [];
  }))).flat();
  return sortDnsRecords([...new Map(records.map((record) => [record.id, record])).values()]);
}

async function applyDnsBatch(
  zone: DnsTarget,
  changes: { deletes: Array<{ id: string }>; patches: Array<Record<string, unknown>>; posts: Array<Record<string, unknown>> },
  env: Env,
  globalApiToken?: string,
) {
  const send = async (batch: typeof changes) => {
    if (!batch.deletes.length && !batch.patches.length && !batch.posts.length) return;
    await cfFetch<unknown>(zone, `/zones/${zone.zoneId}/dns_records/batch`, {
      method: "POST",
      body: JSON.stringify(batch),
    }, env, globalApiToken);
  };
  const batchSize = 500;
  for (let start = 0; start < changes.deletes.length; start += batchSize) {
    await send({ deletes: changes.deletes.slice(start, start + batchSize), patches: [], posts: [] });
  }
  for (let start = 0; start < changes.patches.length; start += batchSize) {
    await send({ deletes: [], patches: changes.patches.slice(start, start + batchSize), posts: [] });
  }
  for (let start = 0; start < changes.posts.length; start += batchSize) {
    await send({ deletes: [], patches: [], posts: changes.posts.slice(start, start + batchSize) });
  }
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
  const removed = records.filter((record) => names.some((name) => sameRecordName(record.name, name)) && conflictingTypes.has(record.type) && !exceptIds.includes(record.id));
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
    const pageRecords = (await cfFetch<DnsRecord[] | undefined>(zone, `/zones/${zone.zoneId}/dns_records?per_page=100&page=${page}`, {}, env, globalApiToken)) ?? [];
    records.push(...pageRecords);
    if (pageRecords.length < 100) break;
  }
  return sortDnsRecords(records);
}

export async function createDnsRecord(zone: DnsTarget, input: Partial<DnsRecord>, env: Env, globalApiToken?: string) {
  const validated = validateRecordInput(zone, input);
  const recordsBeforeChange = await listDnsRecords(zone, env, globalApiToken);
  const duplicateRoot = recordsBeforeChange.find((record) => sameRecordName(record.name, validated.name) && record.type === validated.type && equivalentDnsContent(record.content, validated.content));
  if (duplicateRoot) throw new HttpError(409, `${validated.type} 记录已经存在：${duplicateRoot.content}`);
  const wildcard = pairedName(zone);
  const pairedNames = shouldSyncWildcard(zone) ? [validated.name, wildcard] : [validated.name];
  await removeConflictingRecords(zone, pairedNames, validated.type, env, globalApiToken);
  const existingWildcard = shouldSyncWildcard(zone)
    ? (await listDnsRecords(zone, env, globalApiToken)).find((record) => sameRecordName(record.name, wildcard) && record.type === validated.type && equivalentDnsContent(record.content, validated.content))
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
  const duplicateRoot = records.find((record) => record.id !== id && sameRecordName(record.name, validated.name) && record.type === validated.type && equivalentDnsContent(record.content, validated.content));
  if (duplicateRoot) throw new HttpError(409, `${validated.type} 记录已经存在：${duplicateRoot.content}`);
  const pairedWildcard = shouldSyncWildcard(zone)
    ? records.find((record) => sameRecordName(record.name, wildcard) && record.type === current.type && equivalentDnsContent(record.content, current.content))
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

/** Reconcile the editable records for a zone with a bulk text-editor payload. */
export async function replaceDnsRecords(zone: DnsTarget, inputs: Array<Partial<DnsRecord>>, env: Env, globalApiToken?: string) {
  const domain = normalizeDomain(zone.domain);
  const validated = inputs.map((input) => validateRecordInput(zone, input, true));
  const unique = [...new Map(validated.map((record) => [
    `${normalizeRecordName(record.name)}:${record.type}:${record.content.trim().toLowerCase()}`,
    record,
  ])).values()];
  const current = (await listDnsRecords(zone, env, globalApiToken)).filter((record) => isEditableDnsRecord(zone, record));
  const remaining = [...current];
  let created = 0;
  let updated = 0;
  let deleted = 0;

  // Keep identical records first, then reuse an existing record at the same name
  // for edits so a type/content change does not require a delete before a post.
  for (const desired of unique) {
    const exactIndex = remaining.findIndex((record) =>
      sameRecordName(record.name, desired.name)
      && record.type === desired.type
      && equivalentDnsContent(record.content, desired.content));
    if (exactIndex >= 0) {
      remaining.splice(exactIndex, 1);
      continue;
    }
    const candidateIndex = remaining.findIndex((record) => sameRecordName(record.name, desired.name));
    if (candidateIndex >= 0) {
      const candidate = remaining.splice(candidateIndex, 1)[0];
      await updateDnsRecord(zone, candidate.id, desired, env, globalApiToken);
      updated++;
    } else {
      await createDnsRecord(zone, desired, env, globalApiToken);
      created++;
    }
  }
  const recordsAfterUpserts = await listDnsRecords(zone, env, globalApiToken);
  for (const record of remaining) {
    if (!recordsAfterUpserts.some((item) => item.id === record.id)) continue;
    await deleteDnsRecord(zone, record.id, env, globalApiToken);
    deleted++;
  }
  if (shouldSyncWildcard(zone)) {
    const wildcard = pairedName(zone);
    const desiredWildcard = new Set(unique.map((record) => `${record.type}:${record.content.trim().toLowerCase()}`));
    const staleWildcard = (await listDnsRecords(zone, env, globalApiToken)).filter((record) =>
      sameRecordName(record.name, wildcard)
      && ["A", "AAAA", "CNAME"].includes(record.type)
      && !desiredWildcard.has(`${record.type}:${record.content.trim().toLowerCase()}`));
    if (staleWildcard.length) {
      await applyDnsBatch(zone, { deletes: staleWildcard.map((record) => ({ id: record.id })), patches: [], posts: [] }, env, globalApiToken);
      deleted += staleWildcard.length;
    }
  }
  return { domain, created, updated, deleted, total: unique.length };
}

export async function deleteDnsRecord(zone: DnsTarget, id: string, env: Env, globalApiToken?: string) {
  if (!/^[a-f0-9-]{8,}$/i.test(id)) throw new HttpError(400, "无效的 DNS 记录 ID");
  const current = (await listDnsRecords(zone, env, globalApiToken)).find((record) => record.id === id);
  if (!current) throw new HttpError(404, "DNS 记录不存在");
  if (!isEditableDnsRecord(zone, current)) throw new HttpError(400, "只能删除主域名或泛域名的 A、AAAA、CNAME 记录");
  const wildcard = pairedName(zone);
  const records = await listDnsRecords(zone, env, globalApiToken);
  const pairedWildcard = shouldSyncWildcard(zone)
    ? records.find((record) => sameRecordName(record.name, wildcard) && record.type === current.type && equivalentDnsContent(record.content, current.content))
    : undefined;
  await deleteRecord(zone, id, env, globalApiToken);
  if (pairedWildcard) await deleteRecord(zone, pairedWildcard.id, env, globalApiToken);
}

export async function clearDnsRecords(zone: DnsTarget, env: Env, globalApiToken?: string) {
  const records = await listDnsRecords(zone, env, globalApiToken);
  const wildcard = pairedName(zone);
  const editableRecords = records.filter((record) => isEditableDnsRecord(zone, record) || (
    shouldSyncWildcard(zone)
    && sameRecordName(record.name, wildcard)
    && ["A", "AAAA", "CNAME"].includes(record.type)
  ));
  if (!editableRecords.length) return 0;
  await applyDnsBatch(zone, {
    deletes: editableRecords.map((record) => ({ id: record.id })),
    patches: [],
    posts: [],
  }, env, globalApiToken);
  return editableRecords.length;
}

export async function syncZone(zone: DnsTarget, ips: string[], env: Env, globalApiToken?: string) {
  const domain = normalizeDomain(zone.domain);
  if (!domain || !zone.zoneId) throw new HttpError(400, "缺少默认域名或 Zone ID");
  const names = shouldSyncWildcard(zone) ? new Set([domain, `*.${domain}`]) : new Set([domain]);
  const allRecords = await listDnsRecordsByNames(zone, names, env, globalApiToken);
  const cnameNames = new Set(allRecords.filter((record) => names.has(normalizeRecordName(record.name)) && record.type === "CNAME").map((record) => normalizeRecordName(record.name)));
  const hasPairedCname = cnameNames.size > 0;
  if (hasPairedCname) return { domain, created: 0, deleted: 0, kept: 0, unproxied: 0, total: 0, skippedCname: true };
  const namesToSync = new Set(names);
  // Compare every existing A/AAAA record, not only records previously marked
  // as managed. This prevents POSTing a duplicate when a user created the
  // same IP manually. Only managed records may be deleted.
  const existing = allRecords.filter((record) => names.has(normalizeRecordName(record.name)) && (record.type === "A" || record.type === "AAAA"));
  const desired = new Map<string, Set<string>>();
  for (const name of namesToSync) desired.set(name, new Set(ips.map((ip) => `${isIPv4(ip) ? "A" : "AAAA"}:${ip}`)));
  const deletes: Array<{ id: string }> = [];
  const patches: Array<Record<string, unknown>> = [];
  const posts: Array<Record<string, unknown>> = [];
  let created = 0, deleted = 0, kept = 0, updated = 0, unproxied = 0;
  const seen = new Set<string>();

  for (const record of existing) {
    const key = `${record.type}:${record.content.trim().toLowerCase()}`;
    const recordName = normalizeRecordName(record.name);
    const desiredForName = desired.get(recordName) ?? new Set<string>();
    const seenKey = `${recordName}:${key}`;
    if (!desiredForName.has(key)) {
      if (isManagedRecord(record)) {
        deletes.push({ id: record.id });
        deleted++;
      }
      continue;
    }
    if (seen.has(seenKey)) {
      if (isManagedRecord(record)) {
        deletes.push({ id: record.id });
        deleted++;
      }
      continue;
    }
    seen.add(seenKey);
    if (record.proxied || !isManagedRecord(record)) {
      // Adopt an identical manual record instead of creating a duplicate.
      // Never send tags because some Cloudflare plans have a tags quota of 0.
      patches.push({ id: record.id, proxied: false, comment: MANAGED_COMMENT });
      updated++;
      if (record.proxied) unproxied++;
    } else kept++;
  }

  for (const name of namesToSync) {
    for (const ip of ips) {
      const type = isIPv4(ip) ? "A" : "AAAA";
      const key = `${name}:${type}:${ip}`;
      if (seen.has(key)) continue;
      posts.push({ type, name, content: ip, ttl: DNS_TTL, proxied: false, comment: MANAGED_COMMENT });
      seen.add(key);
      created++;
    }
  }
  await applyDnsBatch(zone, { deletes, patches, posts }, env, globalApiToken);
  return { domain, created, deleted, kept, updated, unproxied, total: ips.length * namesToSync.size, skippedCname: hasPairedCname };
}
