import { SYNC_LOCK_NAME } from "../config";
import { LockBusyError, HttpError } from "../errors";
import { collectPreferredIps } from "./ip-sources";
import { getSettings } from "./settings";
import { Env } from "../types";
import { syncZone } from "./cloudflare-dns";

export async function withSyncLock<T>(env: Env, task: () => Promise<T>): Promise<T> {
  const stub = env.SYNC_LOCK.get(env.SYNC_LOCK.idFromName(SYNC_LOCK_NAME));
  const response = await stub.fetch("https://sync-lock/acquire", { method: "POST", body: JSON.stringify({ ttl: 15 * 60 * 1000 }) });
  if (!response.ok) throw new LockBusyError("已有同步任务正在运行，请稍后再试");
  try {
    return await task();
  } finally {
    await stub.fetch("https://sync-lock/release", { method: "POST" });
  }
}

export async function runSync(env: Env, zoneId?: string) {
  return withSyncLock(env, async () => {
    const settings = await getSettings(env);
    const zones = zoneId ? settings.zones.filter((zone) => zone.id === zoneId) : settings.zones;
    if (!zones.length) throw new HttpError(400, "没有可同步的 Zone");
    const collected = await collectPreferredIps(settings, true);
    if (!collected.reachable.length) throw new HttpError(502, "没有通过 TCP 443 检测的优选 IP，已停止同步以保护现有 DNS 记录");
    const results = [];
    for (const zone of zones) results.push(await syncZone(zone, collected.reachable, env));
    return { at: new Date().toISOString(), candidates: collected.merged.length, reachable: collected.reachable, sources: collected.sources, results };
  });
}

