import { readFileSync } from "node:fs";

const file = new URL("../src/ui/admin-page.ts", import.meta.url);
const source = readFileSync(file, "utf8");
for (const marker of ['id="getRegions"', 'id="saveRegions"', '/api/ips/regions', '/api/ips/regions/config', 'region-select-all', 'region-clear-all', 'loadRegionCatalog', "#saveRegions')?.addEventListener('click',saveRegionConfig"]) {
  if (!source.includes(marker)) throw new Error(`管理页缺少地区获取功能标记：${marker}`);
}
for (const marker of ['region-invert', 'region-select-common', 'regionSearch']) {
  if (source.includes(marker)) throw new Error(`管理页仍包含已移除的地区增强功能：${marker}`);
}
const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1].replace(/\$\{adminLayoutScript\}/g, ""));

if (!scripts.length) throw new Error("无法找到管理页内嵌脚本");
scripts.forEach((script) => new Function(script));

const layoutFile = new URL("../src/ui/admin-layout.ts", import.meta.url);
const layoutSource = readFileSync(layoutFile, "utf8");
const layoutMatch = layoutSource.match(/String\.raw`([\s\S]*)`;\s*$/);
if (!layoutMatch) throw new Error("无法找到管理台布局脚本");
new Function(layoutMatch[1]);
console.log(`Embedded admin scripts syntax: ok (${scripts.length + 1})`);
