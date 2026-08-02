import { MAX_SOURCE_ITEMS } from "../config";
import { normalizeIp, validIp } from "../validation";

const BRACKET_ENDPOINT_PATTERN = /\[(?<address>[0-9a-f:]+)\](?::(?<port>\d{1,5}))?(?!:)/gi;
const IPV4_ENDPOINT_PATTERN = /(?<![\d.])(?<address>(?:\d{1,3}\.){3}\d{1,3})(?::(?<port>\d{1,5}))?(?![:\d.])/g;

export interface CollectedIpEntry {
  ip: string;
  regions: string[];
}

function normalizeRegion(value: string) {
  return value.match(/^\s*#\s*([a-z]{2,12})(?=$|[^a-z])/i)?.[1]?.toUpperCase();
}

function addIp(value: string, region: string | undefined, result: Map<string, CollectedIpEntry>) {
  const ip = normalizeIp(value);
  if (!validIp(ip)) return;
  const existing = result.get(ip);
  if (existing) {
    if (region && !existing.regions.includes(region)) existing.regions.push(region);
    return;
  }
  if (result.size < MAX_SOURCE_ITEMS) result.set(ip, { ip, regions: region ? [region] : [] });
}

function collectEndpointIps(text: string, result: Map<string, CollectedIpEntry>) {
  for (const pattern of [BRACKET_ENDPOINT_PATTERN, IPV4_ENDPOINT_PATTERN]) {
    for (const match of text.matchAll(pattern)) {
      const address = match.groups?.address;
      const port = match.groups?.port;
      const matchEnd = (match.index ?? 0) + match[0].length;
      const lineEnd = text.indexOf("\n", matchEnd);
      const suffix = text.slice(matchEnd, lineEnd === -1 ? text.length : lineEnd);
      const region = normalizeRegion(suffix);
      if (address && (!port || port === "443")) addIp(address, region, result);
      if (result.size >= MAX_SOURCE_ITEMS) return;
    }
  }
}

export function collectIpEntries(value: unknown, result = new Map<string, CollectedIpEntry>()) {
  if (result.size >= MAX_SOURCE_ITEMS) return [...result.values()];
  if (typeof value === "string") {
    collectEndpointIps(value, result);
    if (result.size >= MAX_SOURCE_ITEMS) return [...result.values()];
    // Prevent endpoints rejected for a non-443 port from being re-added as bare IPs.
    const withoutEndpoints = value
      .replace(BRACKET_ENDPOINT_PATTERN, " ")
      .replace(IPV4_ENDPOINT_PATTERN, " ");
    const tokens = withoutEndpoints.split(/[\s,;"'\[\]{}()<>/#]+/);
    for (const token of tokens) {
      if (validIp(token)) addIp(token, undefined, result);
      if (result.size >= MAX_SOURCE_ITEMS) break;
    }
  } else if (Array.isArray(value)) {
    for (const item of value) collectIpEntries(item, result);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectIpEntries(item, result);
  }
  return [...result.values()].slice(0, MAX_SOURCE_ITEMS);
}

export function regionSummary(entries: CollectedIpEntry[]) {
  const regionCounts: Record<string, number> = {};
  let untaggedCount = 0;
  for (const entry of entries) {
    if (!entry.regions.length) untaggedCount++;
    for (const region of entry.regions) regionCounts[region] = (regionCounts[region] ?? 0) + 1;
  }
  return { regions: Object.keys(regionCounts).sort(), regionCounts, untaggedCount };
}
