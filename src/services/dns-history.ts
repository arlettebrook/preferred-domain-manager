import { DNS_HISTORY_LIMIT } from "../config";
import { DnsHistoryAction, DnsHistoryEntry, DnsHistoryRecord, DnsRecord, Env } from "../types";

function historyKey(zoneId: string) {
  return `dns:history:${zoneId}`;
}

function snapshotRecord(record: DnsRecord): DnsHistoryRecord {
  return {
    id: record.id,
    type: record.type,
    name: record.name,
    content: record.content,
    ...(record.ttl === undefined ? {} : { ttl: record.ttl }),
    ...(record.proxied === undefined ? {} : { proxied: record.proxied }),
    ...(record.comment === undefined ? {} : { comment: record.comment }),
    ...(record.tags === undefined ? {} : { tags: [...record.tags] }),
    ...(record.priority === undefined ? {} : { priority: record.priority }),
  };
}

export function snapshotDnsRecords(records: DnsRecord[]) {
  return records.map(snapshotRecord);
}

export async function getDnsHistory(env: Env, zoneId: string) {
  return (await env.PDM_KV.get<DnsHistoryEntry[]>(historyKey(zoneId), "json")) ?? [];
}

export async function appendDnsHistory(
  env: Env,
  zoneId: string,
  entry: Omit<DnsHistoryEntry, "id" | "at">,
) {
  const current = await getDnsHistory(env, zoneId);
  const next: DnsHistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
  };
  await env.PDM_KV.put(historyKey(zoneId), JSON.stringify([next, ...current].slice(0, DNS_HISTORY_LIMIT)));
  return next;
}

export function publicDnsHistory(entries: DnsHistoryEntry[]) {
  return entries.map(({ before, after, ...entry }) => ({
    ...entry,
    beforeCount: before.length,
    afterCount: after.length,
  }));
}

export function historyEntryActionLabel(action: DnsHistoryAction) {
  return ({ create: "创建", update: "编辑", delete: "删除", rollback: "回滚" } satisfies Record<DnsHistoryAction, string>)[action];
}
