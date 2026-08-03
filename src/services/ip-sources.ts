import { connect } from "cloudflare:sockets";
import { MAX_TCP_CHECK_ITEMS, PREFERRED_IP_CACHE_KEY, PREFERRED_IP_CACHE_TTL_MS, TCP_CHECK_CONCURRENCY, TCP_CHECK_TIMEOUT_MS } from "../config";
import { CollectedIps, Env, IpSource, PreferredIpSnapshot, Settings, SourceResult } from "../types";
import { dedupeIps, isIPv4 } from "../validation";
import { collectIpEntries, CollectedIpEntry, regionSummary } from "./ip-source-parser";

function sourceResult(source: IpSource, entries: CollectedIpEntry[], preferredRegions?: string[], error?: string): SourceResult {
  const selected = preferredRegions ? new Set(preferredRegions) : undefined;
  const filtered = selected ? entries.filter((entry) => !entry.regions.length || entry.regions.some((region) => selected.has(region))) : entries;
  const summary = regionSummary(entries);
  return {
    source,
    ips: filtered.map((entry) => entry.ip),
    allIps: entries.map((entry) => entry.ip),
    ipRegions: Object.fromEntries(entries.map((entry) => [entry.ip, entry.regions])),
    ...summary,
    ...(error ? { error } : {}),
  };
}

async function fetchSource(source: IpSource, preferredRegions?: string[]): Promise<SourceResult> {
  if (!source.enabled || !source.url) return sourceResult(source, [], preferredRegions);
  try {
    const response = await fetch(source.url, { headers: { accept: "application/json,text/plain,*/*" }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    let payload: unknown = text;
    try { payload = JSON.parse(text); } catch { /* plain text source */ }
    return sourceResult(source, collectIpEntries(payload), preferredRegions);
  } catch (error) {
    return sourceResult(source, [], preferredRegions, error instanceof Error ? error.message : "请求失败");
  }
}

export async function isTcp443Reachable(ip: string) {
  let socket: ReturnType<typeof connect> | undefined;
  try {
    socket = connect({ hostname: ip, port: 443 });
    await Promise.race([socket.opened, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TCP_CHECK_TIMEOUT_MS))]);
    return true;
  } catch {
    return false;
  } finally {
    try { socket?.close(); } catch { /* already closed */ }
  }
}

async function filterReachable(ips: string[]) {
  const candidates = ips.slice(0, MAX_TCP_CHECK_ITEMS);
  const result = await checkTcp443Batch(candidates);
  return {
    ips: result.ips,
    checkedCount: candidates.length,
    skippedCount: Math.max(0, ips.length - candidates.length),
  };
}

export async function checkTcp443Batch(ips: string[]) {
  const candidates = dedupeIps(ips).slice(0, MAX_TCP_CHECK_ITEMS);
  const reachable: string[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const current = candidates[cursor++];
      if (await isTcp443Reachable(current)) reachable.push(current);
    }
  };
  await Promise.all(Array.from({ length: Math.min(TCP_CHECK_CONCURRENCY, Math.max(1, candidates.length)) }, worker));
  return {
    ips: reachable.sort((left, right) => (isIPv4(left) === isIPv4(right) ? left.localeCompare(right) : isIPv4(left) ? -1 : 1)),
  };
}

export async function collectPreferredIps(settings: Settings, checkTcp = false): Promise<CollectedIps> {
  const preferredRegions = Array.isArray(settings.preferredRegions) && settings.preferredRegions.length ? settings.preferredRegions : undefined;
  const sourceResults = await Promise.all(settings.ipSources.map((source) => fetchSource(source, preferredRegions)));
  const sourceIps = dedupeIps(sourceResults.flatMap((item) => item.ips));
  const merged = dedupeIps([...settings.manualIps, ...sourceIps]);
  const reachability = checkTcp ? await filterReachable(merged) : { ips: merged, checkedCount: 0, skippedCount: 0 };
  const allEntries = new Map<string, CollectedIpEntry>();
  for (const source of sourceResults) {
    for (const ip of source.allIps) {
      const regions = source.ipRegions[ip] ?? [];
      const existing = allEntries.get(ip);
      if (existing) {
        for (const region of regions) if (!existing.regions.includes(region)) existing.regions.push(region);
      } else {
        allEntries.set(ip, { ip, regions: [...regions] });
      }
    }
  }
  const summary = regionSummary([...allEntries.values()]);
  return {
    checkedTcp: checkTcp,
    checkedCount: reachability.checkedCount,
    skippedCount: reachability.skippedCount,
    sourceIps,
    sourceTotal: allEntries.size,
    merged,
    reachable: reachability.ips,
    availableRegions: summary.regions,
    preferredRegions: preferredRegions ?? null,
    regionCounts: summary.regionCounts,
    untaggedCount: summary.untaggedCount,
    sources: sourceResults.map(({ source, ips, allIps, regions, regionCounts, untaggedCount, error }) => ({
      id: source.id,
      url: source.url,
      enabled: source.enabled,
      count: ips.length,
      totalCount: allIps.length,
      regions,
      regionCounts,
      untaggedCount,
      note: source.note,
      error,
    })),
  };
}

export async function savePreferredIpSnapshot(env: Env, settings: Settings, collected: CollectedIps) {
  const snapshot: PreferredIpSnapshot = {
    settingsUpdatedAt: settings.updatedAt,
    checkedAt: new Date().toISOString(),
    collected,
  };
  await env.PDM_KV.put(PREFERRED_IP_CACHE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export async function getPreferredIpSnapshot(env: Env, settings: Settings) {
  const snapshot = await env.PDM_KV.get<PreferredIpSnapshot>(PREFERRED_IP_CACHE_KEY, "json");
  if (!snapshot || snapshot.settingsUpdatedAt !== settings.updatedAt || !snapshot.collected?.checkedTcp) return undefined;
  // Discard snapshots created before region-aware collection was introduced.
  if (!Array.isArray(snapshot.collected.availableRegions) || !Array.isArray(snapshot.collected.sources)) return undefined;
  // Empty selection used to mean "only untagged"; it now means unrestricted, so old snapshots must be rebuilt.
  if (Array.isArray(snapshot.collected.preferredRegions) && snapshot.collected.preferredRegions.length === 0) return undefined;
  if (snapshot.collected.checkedCount !== snapshot.collected.merged.length || snapshot.collected.skippedCount !== 0) return undefined;
  const checkedAt = Date.parse(snapshot.checkedAt);
  if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > PREFERRED_IP_CACHE_TTL_MS) return undefined;
  return snapshot;
}
