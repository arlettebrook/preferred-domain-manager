import { connect } from "cloudflare:sockets";
import { MAX_SOURCE_ITEMS, MAX_TCP_CHECK_ITEMS, PREFERRED_IP_CACHE_KEY, PREFERRED_IP_CACHE_TTL_MS, TCP_CHECK_CONCURRENCY, TCP_CHECK_TIMEOUT_MS } from "../config";
import { CollectedIps, Env, IpSource, PreferredIpSnapshot, Settings, SourceResult } from "../types";
import { dedupeIps, isIPv4, normalizeIp, validIp } from "../validation";

const ENDPOINT_PATTERN = /(?:^|[\s,;"'([{])(?<address>\[(?:[0-9a-f:]+)\]|(?:\d{1,3}\.){3}\d{1,3}):(?<port>\d{1,5})(?=$|[\s,;"'\]})#])/gi;

function addIp(value: string, result: string[]) {
  const ip = normalizeIp(value);
  if (result.length < MAX_SOURCE_ITEMS && validIp(ip)) result.push(ip);
}

function collectEndpointIps(text: string, result: string[]) {
  for (const match of text.matchAll(ENDPOINT_PATTERN)) {
    if (match.groups?.port === "443" && match.groups.address) {
      addIp(match.groups.address, result);
    }
    if (result.length >= MAX_SOURCE_ITEMS) break;
  }
}

function collectIpStrings(value: unknown, result: string[] = []) {
  if (result.length >= MAX_SOURCE_ITEMS) return result;
  if (typeof value === "string") {
    // Sources may return nodes such as `1.2.3.4:443#label`. Only endpoints
    // explicitly using TCP 443 are eligible; plain IP tokens remain supported
    // for older sources that return one IP per line.
    collectEndpointIps(value, result);
    if (result.length >= MAX_SOURCE_ITEMS) return result;
    const tokens = value.split(/[\s,;"'\[\]{}]+/).map(normalizeIp).filter(validIp);
    for (const token of tokens) addIp(token, result);
  } else if (Array.isArray(value)) {
    for (const item of value) collectIpStrings(item, result);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectIpStrings(item, result);
  }
  return result.slice(0, MAX_SOURCE_ITEMS);
}

async function fetchSource(source: IpSource): Promise<SourceResult> {
  if (!source.enabled || !source.url) return { source, ips: [] };
  try {
    const response = await fetch(source.url, { headers: { accept: "application/json,text/plain,*/*" }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    let payload: unknown = text;
    try { payload = JSON.parse(text); } catch { /* plain text source */ }
    return { source, ips: dedupeIps(collectIpStrings(payload)) };
  } catch (error) {
    return { source, ips: [], error: error instanceof Error ? error.message : "请求失败" };
  }
}

async function tcp443Reachable(ip: string) {
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
  const reachable: string[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const current = candidates[cursor++];
      if (await tcp443Reachable(current)) reachable.push(current);
    }
  };
  await Promise.all(Array.from({ length: Math.min(TCP_CHECK_CONCURRENCY, Math.max(1, candidates.length)) }, worker));
  return {
    ips: reachable.sort((left, right) => (isIPv4(left) === isIPv4(right) ? left.localeCompare(right) : isIPv4(left) ? -1 : 1)),
    checkedCount: candidates.length,
    skippedCount: Math.max(0, ips.length - candidates.length),
  };
}

export async function collectPreferredIps(settings: Settings, checkTcp = true): Promise<CollectedIps> {
  const sourceResults = await Promise.all(settings.ipSources.map(fetchSource));
  const sourceIps = dedupeIps(sourceResults.flatMap((item) => item.ips));
  const merged = dedupeIps([...settings.manualIps, ...sourceIps]);
  const reachability = checkTcp ? await filterReachable(merged) : { ips: merged, checkedCount: 0, skippedCount: 0 };
  return {
    checkedTcp: checkTcp,
    checkedCount: reachability.checkedCount,
    skippedCount: reachability.skippedCount,
    sourceIps,
    merged,
    reachable: reachability.ips,
    sources: sourceResults.map(({ source, ips, error }) => ({ id: source.id, url: source.url, enabled: source.enabled, count: ips.length, error })),
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
  const checkedAt = Date.parse(snapshot.checkedAt);
  if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > PREFERRED_IP_CACHE_TTL_MS) return undefined;
  return snapshot;
}
