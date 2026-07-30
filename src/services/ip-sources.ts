import { connect } from "cloudflare:sockets";
import { MAX_SOURCE_ITEMS } from "../config";
import { CollectedIps, IpSource, Settings, SourceResult } from "../types";
import { dedupeIps, isIPv4, normalizeIp, validIp } from "../validation";

function collectIpStrings(value: unknown, result: string[] = []) {
  if (result.length >= MAX_SOURCE_ITEMS) return result;
  if (typeof value === "string") {
    const tokens = value.split(/[\s,;"'\[\]{}]+/).map(normalizeIp).filter(validIp);
    result.push(...tokens);
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
    await Promise.race([socket.opened, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 4500))]);
    return true;
  } catch {
    return false;
  } finally {
    try { socket?.close(); } catch { /* already closed */ }
  }
}

async function filterReachable(ips: string[]) {
  const reachable: string[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < ips.length) {
      const current = ips[cursor++];
      if (await tcp443Reachable(current)) reachable.push(current);
    }
  };
  await Promise.all(Array.from({ length: Math.min(20, Math.max(1, ips.length)) }, worker));
  return reachable.sort((left, right) => (isIPv4(left) === isIPv4(right) ? left.localeCompare(right) : isIPv4(left) ? -1 : 1));
}

export async function collectPreferredIps(settings: Settings, checkTcp = true): Promise<CollectedIps> {
  const sourceResults = await Promise.all(settings.ipSources.map(fetchSource));
  const merged = dedupeIps([...settings.manualIps, ...sourceResults.flatMap((item) => item.ips)]);
  const reachable = checkTcp ? await filterReachable(merged) : merged;
  return {
    merged,
    reachable,
    sources: sourceResults.map(({ source, ips, error }) => ({ id: source.id, url: source.url, count: ips.length, error })),
  };
}

