import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const types = read("src/types.ts");
const config = read("src/config.ts");
const settings = read("src/services/settings.ts");
const api = read("src/api.ts");
const main = read("src/main.ts");
const sync = read("src/services/sync.ts");
const lock = read("src/durable-objects/sync-lock.ts");
const ui = read("src/ui/admin-page.ts") + read("src/ui/admin-core-script.ts") + read("src/ui/admin-domain-script.ts");
const wrangler = read("wrangler.toml");

const cronConfigRoute = api.slice(api.indexOf("if (url.pathname === CRON_CONFIG.apiRoutes.config"), api.indexOf('if (url.pathname === "/api/ip-sources"'));
if (cronConfigRoute.includes("PDM_KV.put")) throw new Error("定时任务开关仍同时写入 KV 与 Durable Object");
if (!api.includes("const { cronEnabled: _legacyCronEnabled, ...baseSettings } = previous")) throw new Error("普通配置保存仍可能保留旧 cronEnabled 字段");

for (const [name, source, markers] of [
  ["config", config, ["const CRON_INTERVAL_MINUTES = 30", "stateVersion: 1", "durableObjectName: \"preferred-ip-cron\"", "storageKey: \"cronConfig\"", "routes:", "apiRoutes:"]],
  ["types", types, ["autoSyncEnabled?: boolean"]],
  ["settings", settings, ["autoSyncEnabled: item.autoSyncEnabled === true", "autoSyncEnabled: false"]],
  ["api", api, ["autoSyncEnabled: item.autoSyncEnabled !== undefined", "autoSyncEnabled: false", "updateCronConfig(env, body.enabled", "getCronConfig(env)", "CRON_CONFIG.routes.config", "CRON_CONFIG.apiRoutes.config", "publicSettings({ ...settings, cronEnabled: currentCronConfig.enabled })"]],
  ["main", main, ["CRON_CONFIG.durableObjectName", "CRON_CONFIG.routes.start"]],
  ["sync", sync, ["automatic?: boolean", "profiles.filter((profile) => profile.autoSyncEnabled === true)", "同步请求必须指定域名", "automatic,"]],
  ["cron", lock, ["runSync(this.env, { automatic: true })", "reason: \"no-enabled-domains\"", "profile.autoSyncEnabled === true", "error instanceof LockBusyError", "setAlarm(Date.now() + CRON_CONFIG.busyRetryDelayMs)", "CronConfigState", "path === CRON_CONFIG.routes.config", "request.method === \"GET\"", "enabled: cronConfig.enabled", "blockConcurrencyWhile", "initializedFrom: hasLegacyValue ? \"legacy-kv\" : \"default\""]],
  ["ui", ui, ["auto-sync-enabled", "自动同步域名：", "自动优选同步", "let dnsLoadSequence=0", "requestId!==dnsLoadSequence", "dnsState.records=[];dnsState.loading=configured", "没有域名参与自动同步"]],
]) {
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`${name} 缺少自动同步约束：${marker}`);
  }
}

const output = join(tmpdir(), "preferred-domain-manager", "settings-auto-sync.cjs");
const lockOutput = join(tmpdir(), "preferred-domain-manager", "sync-lock-auto-sync.cjs");
const configOutput = join(tmpdir(), "preferred-domain-manager", "cron-config-check.cjs");
mkdirSync(dirname(output), { recursive: true });
execFileSync(process.execPath, [join("node_modules", "esbuild", "bin", "esbuild"), "src/services/settings.ts", "--bundle", "--platform=node", "--format=cjs", `--outfile=${output}`], { stdio: "ignore" });
execFileSync(process.execPath, [join("node_modules", "esbuild", "bin", "esbuild"), "src/durable-objects/sync-lock.ts", "--bundle", "--platform=node", "--format=cjs", "--alias:cloudflare:sockets=./scripts/cloudflare-sockets-shim.mjs", `--outfile=${lockOutput}`], { stdio: "ignore" });
execFileSync(process.execPath, [join("node_modules", "esbuild", "bin", "esbuild"), "src/config.ts", "--bundle", "--platform=node", "--format=cjs", `--outfile=${configOutput}`], { stdio: "ignore" });
const require = createRequire(import.meta.url);
const { defaultSettings, domainProfiles } = require(output);
const { SyncLock } = require(lockOutput);
const { CRON_CONFIG } = require(configOutput);

if (CRON_CONFIG.intervalLabel !== `${CRON_CONFIG.intervalMinutes} 分钟`) throw new Error("Cron 显示间隔未从分钟常量派生");
if (CRON_CONFIG.intervalMs !== CRON_CONFIG.intervalMinutes * 60 * 1000) throw new Error("Cron 毫秒间隔与分钟常量不一致");
const configuredSchedules = [...wrangler.matchAll(/crons\s*=\s*\[([^\]]+)\]/g)].flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]));
if (!configuredSchedules.includes(CRON_CONFIG.schedule)) throw new Error(`wrangler.toml Cron 表达式与 CRON_CONFIG 不一致：${CRON_CONFIG.schedule}`);
if (Object.hasOwn(defaultSettings(), "cronEnabled")) throw new Error("新安装仍会把旧 cronEnabled 字段写入 KV");

const profiles = domainProfiles({
  domains: [
    { id: "enabled", domain: "enabled.example", zoneId: "zone-1", autoSyncEnabled: true },
    { id: "legacy", domain: "legacy.example", zoneId: "zone-2" },
  ],
});
if (profiles[0]?.autoSyncEnabled !== true) throw new Error("显式开启的域名未保留自动同步状态");
if (profiles[1]?.autoSyncEnabled !== false) throw new Error("旧域名配置没有默认关闭自动同步");

const legacyProfile = domainProfiles({ defaultDomain: "single.example", cfZoneId: "zone-3" });
if (legacyProfile[0]?.autoSyncEnabled !== false) throw new Error("旧版单域名配置没有默认关闭自动同步");

const cronUrl = (route) => `https://probe${route}`;
function createState(initial = []) {
  const values = new Map(initial);
  let initializationCount = 0;
  const storage = {
    get: async (key) => values.get(key),
    put: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
    deleteAlarm: async () => {},
    getAlarm: async () => null,
  };
  return {
    state: {
      storage,
      blockConcurrencyWhile: async (callback) => {
        initializationCount++;
        return callback();
      },
    },
    values,
    initializationCount: () => initializationCount,
  };
}

const legacyKvState = createState();
let legacyKvReads = 0;
const legacyKvLock = new SyncLock(legacyKvState.state, { PDM_KV: { get: async () => { legacyKvReads++; return { cronEnabled: false, updatedAt: "kv-legacy" }; } } });
const migratedKvStatus = await (await legacyKvLock.fetch(new Request(cronUrl(CRON_CONFIG.routes.config)))).json();
if (migratedKvStatus.cronEnabled !== false) throw new Error("旧 KV 关闭状态未迁移到 Durable Object");
const migratedKvConfig = legacyKvState.values.get(CRON_CONFIG.storageKey);
if (migratedKvConfig?.version !== CRON_CONFIG.stateVersion || migratedKvConfig?.initializedFrom !== "legacy-kv") throw new Error("旧 KV 状态缺少版本化迁移标记");
await legacyKvLock.fetch(new Request(cronUrl(CRON_CONFIG.routes.config)));
if (legacyKvReads !== 1 || legacyKvState.initializationCount() !== 1) throw new Error("Cron 配置重复执行初始化迁移");
await legacyKvLock.fetch(new Request(cronUrl(CRON_CONFIG.routes.config), { method: "PUT", body: JSON.stringify({ enabled: true }) }));
if (legacyKvState.values.get(CRON_CONFIG.storageKey)?.initializedFrom !== "legacy-kv") throw new Error("更新 Cron 开关时丢失了初始化迁移来源");

const defaultState = createState();
const defaultLock = new SyncLock(defaultState.state, { PDM_KV: { get: async () => ({ updatedAt: "fresh-settings" }) } });
const defaultStatus = await (await defaultLock.fetch(new Request(cronUrl(CRON_CONFIG.routes.config)))).json();
const defaultConfig = defaultState.values.get(CRON_CONFIG.storageKey);
if (defaultStatus.cronEnabled !== CRON_CONFIG.defaultEnabled || defaultConfig?.initializedFrom !== "default") throw new Error("新安装未使用统一的 Cron 默认配置初始化");

const legacyDoState = createState([[CRON_CONFIG.storageKey, { enabled: false, updatedAt: "do-legacy" }]]);
let legacyDoKvReads = 0;
const legacyDoLock = new SyncLock(legacyDoState.state, { PDM_KV: { get: async () => { legacyDoKvReads++; return { cronEnabled: true, updatedAt: "kv-stale" }; } } });
const migratedDoStatus = await (await legacyDoLock.fetch(new Request(cronUrl(CRON_CONFIG.routes.config)))).json();
const migratedDoConfig = legacyDoState.values.get(CRON_CONFIG.storageKey);
if (migratedDoStatus.cronEnabled !== false || migratedDoConfig?.initializedFrom !== "durable-object") throw new Error("旧 Durable Object 状态升级时未保留当前开关");
if (legacyDoKvReads !== 0) throw new Error("升级旧 Durable Object 状态时仍读取了 KV");

const apiState = createState();
const staleKvSettings = { ipSources: [], manualIps: [], domains: [], cronEnabled: true, updatedAt: "kv-stale" };
let apiKvReads = 0;
const env = { PDM_KV: { get: async () => { apiKvReads++; return staleKvSettings; } } };
const cronLock = new SyncLock(apiState.state, env);
const disabledWrite = await cronLock.fetch(new Request(cronUrl(CRON_CONFIG.routes.config), { method: "PUT", body: JSON.stringify({ enabled: false, updatedAt: "do-current" }) }));
if (!disabledWrite.ok) throw new Error("关闭定时任务未能写入 Durable Object");
const disabledStatus = await (await cronLock.fetch(new Request(cronUrl(CRON_CONFIG.routes.config)))).json();
if (disabledStatus.cronEnabled !== false) throw new Error("Durable Object 未保持关闭状态");
if (apiKvReads !== 0) throw new Error("首次 API 写入后仍触发了旧 KV 初始化迁移");
const disabledStart = await (await cronLock.fetch(new Request(cronUrl(CRON_CONFIG.routes.start), { method: "POST" }))).json();
if (disabledStart.reason !== "disabled") throw new Error("KV 返回旧开启状态时 Cron 仍被错误启动");
await cronLock.fetch(new Request(cronUrl(CRON_CONFIG.routes.config), { method: "PUT", body: JSON.stringify({ enabled: true, updatedAt: "do-newer" }) }));
const enabledStatus = await (await cronLock.fetch(new Request(cronUrl(CRON_CONFIG.routes.config)))).json();
if (enabledStatus.cronEnabled !== true) throw new Error("Durable Object 未恢复开启状态");

rmSync(output, { force: true });
rmSync(lockOutput, { force: true });
rmSync(configOutput, { force: true });

console.log("Per-domain automatic sync checks: ok");
