import { MAX_TCP_CHECK_ITEMS } from "../config";
import { checkTcp443Batch, collectPreferredIps, savePreferredIpSnapshot } from "../services/ip-sources";
import { getSettings } from "../services/settings";
import { runSync } from "../services/sync";
import { CollectedIps, Env } from "../types";

interface ProbeState {
  settingsUpdatedAt: string;
  collected: CollectedIps;
  cursor: number;
  reachable: string[];
  updatedAt: number;
  scheduled?: boolean;
}

export class SyncLock {
  constructor(private state: DurableObjectState, private env: Env) {}

  async alarm() {
    const probe = await this.state.storage.get<ProbeState>("probe");
    if (!probe?.scheduled) return;
    try {
      const settings = await getSettings(this.env);
      if (settings.cronEnabled === false) {
        await this.state.storage.delete("probe");
        return;
      }
      if (Array.isArray(probe.collected.preferredRegions) && probe.collected.preferredRegions.length === 0) {
        await this.state.storage.delete("probe");
        return;
      }
      if (settings.updatedAt !== probe.settingsUpdatedAt) throw new Error("优选配置已变化，本轮定时检测已取消");
      const batch = probe.collected.merged.slice(probe.cursor, probe.cursor + MAX_TCP_CHECK_ITEMS);
      if (batch.length) {
        const checked = await checkTcp443Batch(batch);
        const updated: ProbeState = {
          ...probe,
          cursor: probe.cursor + batch.length,
          reachable: [...new Set([...probe.reachable, ...checked.ips])],
          updatedAt: Date.now(),
        };
        await this.state.storage.put("probe", updated);
        await this.state.storage.setAlarm(Date.now() + 1000);
        return;
      }
      const collected: CollectedIps = {
        ...probe.collected,
        reachable: probe.reachable,
        checkedTcp: true,
        checkedCount: probe.cursor,
        skippedCount: 0,
      };
      await savePreferredIpSnapshot(this.env, settings, collected);
      const result = await runSync(this.env);
      const dnsChanges = result.results.reduce((summary, entry) => {
        if (!entry.ok || !entry.result) return summary;
        summary.created += entry.result.created ?? 0;
        summary.updated += entry.result.updated ?? 0;
        summary.deleted += entry.result.deleted ?? 0;
        summary.kept += entry.result.kept ?? 0;
        return summary;
      }, { created: 0, updated: 0, deleted: 0, kept: 0 });
      await this.state.storage.put("lastCronResult", { ok: result.ok, at: new Date().toISOString(), checkedCount: collected.checkedCount, reachableCount: collected.reachable.length, preferredRegions: collected.preferredRegions, dnsChanges, result });
      await this.state.storage.delete("probe");
    } catch (error) {
      await this.state.storage.put("lastCronResult", { ok: false, at: new Date().toISOString(), error: error instanceof Error ? error.message : "定时检测失败" });
      await this.state.storage.delete("probe");
      throw error;
    }
  }

  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === "/cron/start" && request.method === "POST") {
      const existing = await this.state.storage.get<ProbeState>("probe");
      if (existing?.scheduled) return Response.json({ ok: true, started: false, reason: "already-running" });
      const settings = await getSettings(this.env);
      if (settings.cronEnabled === false) return Response.json({ ok: true, started: false, reason: "disabled" });
      const collected = await collectPreferredIps(settings, false);
      if (!collected.merged.length) {
        await this.state.storage.put("lastCronResult", { ok: false, at: new Date().toISOString(), error: "没有可检测的优选 IP" });
        return Response.json({ ok: false, started: false, reason: "no-candidates" }, { status: 422 });
      }
      const probe: ProbeState = { settingsUpdatedAt: settings.updatedAt, collected, cursor: 0, reachable: [], updatedAt: Date.now(), scheduled: true };
      await this.state.storage.put("probe", probe);
      await this.state.storage.setAlarm(Date.now() + 1000);
      return Response.json({ ok: true, started: true, total: collected.merged.length });
    }
    if (path === "/cron/status") {
      const settings = await getSettings(this.env);
      const probe = await this.state.storage.get<ProbeState>("probe");
      const lastResult = await this.state.storage.get<Record<string, unknown>>("lastCronResult");
      const nextAlarm = await this.state.storage.getAlarm();
      return Response.json({ enabled: settings.cronEnabled !== false, running: Boolean(probe?.scheduled), checkedCount: probe?.cursor ?? 0, total: probe?.collected.merged.length ?? 0, reachableCount: probe?.reachable.length ?? 0, nextAlarm, lastResult: lastResult ?? null });
    }
    if (path === "/cron/cancel" && request.method === "POST") {
      const probe = await this.state.storage.get<ProbeState>("probe");
      if (probe?.scheduled) await this.state.storage.delete("probe");
      await this.state.storage.deleteAlarm();
      return Response.json({ ok: true });
    }
    if (path === "/probe/start" && request.method === "POST") {
      const body = await request.json<{ settingsUpdatedAt: string; collected: unknown }>();
      await this.state.storage.put("probe", {
        settingsUpdatedAt: body.settingsUpdatedAt,
        collected: body.collected,
        cursor: 0,
        reachable: [],
        updatedAt: Date.now(),
      });
      return Response.json({ ok: true });
    }
    if (path === "/probe/state") {
      const probe = await this.state.storage.get<Record<string, unknown>>("probe");
      return probe ? Response.json({ available: true, ...probe }) : Response.json({ available: false });
    }
    if (path === "/probe/record" && request.method === "POST") {
      const body = await request.json<{ cursor: number; checkedCount: number; reachable: string[] }>();
      let response = Response.json({ error: "检测任务不存在" }, { status: 404 });
      await this.state.blockConcurrencyWhile(async () => {
        const probe = await this.state.storage.get<{ cursor: number; reachable: string[]; collected: { merged: string[] } }>("probe");
        if (!probe) return;
        if (probe.cursor !== body.cursor) {
          response = Response.json({ error: "检测批次已过期" }, { status: 409 });
          return;
        }
        const nextCursor = probe.cursor + body.checkedCount;
        const updated = { ...probe, cursor: nextCursor, reachable: [...new Set([...probe.reachable, ...body.reachable])], updatedAt: Date.now() };
        await this.state.storage.put("probe", updated);
        response = Response.json({ cursor: nextCursor, total: probe.collected.merged.length, reachable: updated.reachable });
      });
      return response;
    }
    if (path === "/probe/clear") {
      await this.state.storage.delete("probe");
      return Response.json({ ok: true });
    }
    if (path === "/acquire") {
      let response: Response;
      await this.state.blockConcurrencyWhile(async () => {
        const now = Date.now();
        const current = await this.state.storage.get<number>("expiresAt");
        if (current && current > now) {
          response = new Response("busy", { status: 409 });
          return;
        }
        const body = await request.json<{ ttl?: number }>().catch(() => ({ ttl: undefined }));
        await this.state.storage.put("expiresAt", now + Math.min(Math.max(body.ttl ?? 900000, 30000), 1800000));
        response = new Response("ok");
      });
      return response!;
    }
    if (path === "/release") {
      await this.state.storage.delete("expiresAt");
      return new Response("ok");
    }
    const now = Date.now();
    const current = await this.state.storage.get<number>("expiresAt");
    return new Response(JSON.stringify({ locked: Boolean(current && current > now), expiresAt: current ?? null }), { headers: { "content-type": "application/json" } });
  }
}
