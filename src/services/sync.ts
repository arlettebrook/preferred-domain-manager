import { SYNC_LOCK_NAME, SYNC_STATE_KEY } from "../config";
import { LockBusyError, HttpError } from "../errors";
import { collectPreferredIps } from "./ip-sources";
import { domainProfiles, effectiveApiToken, effectiveTarget, getSettings } from "./settings";
import { Env, SyncState } from "../types";
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

export async function runSync(env: Env, domainId?: string) {
  const result = await withSyncLock(env, async () => {
    const settings = await getSettings(env);
    const profiles = domainProfiles(settings);
    const targets = domainId
      ? (() => {
          const target = effectiveTarget(settings, domainId);
          return target ? [{ id: domainId, target }] : [];
        })()
      : profiles.map((profile) => ({
          id: profile.id,
          target: { zoneId: profile.zoneId, domain: profile.domain, syncWildcard: profile.syncWildcard !== false },
        }));
    if (!targets.length) throw new HttpError(domainId ? 404 : 400, domainId ? "指定的域名不存在" : "没有配置默认域名或 Zone ID");
    const collected = await collectPreferredIps(settings, true);
    if (!collected.reachable.length) throw new HttpError(502, "没有通过 TCP 443 检测的优选 IP，已停止同步以保护现有 DNS 记录");
    const results: Array<{ id: string; domain: string; ok: boolean; result?: Awaited<ReturnType<typeof syncZone>>; error?: string }> = [];
    for (const entry of targets) {
      try {
        const apiToken = effectiveApiToken(settings, entry.id);
        if (!apiToken) throw new HttpError(400, `域名 ${entry.target.domain} 尚未配置 Cloudflare API Token`);
        results.push({ id: entry.id, domain: entry.target.domain, ok: true, result: await syncZone(entry.target, collected.reachable, env, apiToken) });
      } catch (error) {
        if (domainId) throw error;
        results.push({ id: entry.id, domain: entry.target.domain, ok: false, error: error instanceof Error ? error.message : "同步失败" });
      }
    }
    const succeeded = results.filter((entry) => entry.ok);
    const failed = results.filter((entry) => !entry.ok);
    return {
      ok: failed.length === 0,
      at: new Date().toISOString(),
      candidates: collected.merged.length,
      reachable: collected.reachable,
      sources: collected.sources,
      result: domainId ? succeeded[0]?.result : results.length === 1 ? results[0] : results,
      results,
    };
  });
  const state: SyncState = {
    at: result.at,
    ok: result.ok,
    candidates: result.candidates,
    reachable: result.reachable.length,
    domains: result.results.length,
    failed: result.results.filter((entry) => !entry.ok).length,
  };
  await env.PDM_KV.put(SYNC_STATE_KEY, JSON.stringify(state));
  return result;
}
