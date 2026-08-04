import { readFileSync } from "node:fs";

const file = new URL("../src/ui/admin-page.ts", import.meta.url);
const source = readFileSync(file, "utf8");
for (const marker of ['id="getRegions"', 'id="saveRegions"', '/api/ips/regions', '/api/ips/regions/config', 'region-select-all', 'region-clear-all', 'loadRegionCatalog', 'savedPreferredRegions', 'regionSelectionChanged', 'catalogFetchedAt', "#saveRegions')?.addEventListener('click',saveRegionConfig"]) {
  if (!source.includes(marker)) throw new Error(`管理页缺少地区获取功能标记：${marker}`);
}
for (const marker of ['region-invert', 'region-select-common', 'regionSearch']) {
  if (source.includes(marker)) throw new Error(`管理页仍包含已移除的地区增强功能：${marker}`);
}
for (const marker of [
  'rel="icon" href="/favicon.svg"',
  ".login{width:100%;max-width:440px;min-width:0}",
  "if(message==='未登录'){setStatus($('#loginStatus'),'')",
  "button.querySelector('.theme-icon')",
  ".top-actions #theme:before{display:none!important",
  "button.setAttribute('aria-current','page')",
  "if(event.key==='Tab')",
  "@media(prefers-reduced-motion:reduce)",
  "class=\"settings-empty\"",
  "id=\"adminPathPreview\"",
  "id=\"homeRedirectEnabled\"",
  "id=\"homeRedirectUrl\"",
  "saveHomeRedirect",
  "id='githubProject'",
  "githubProjectUrl='https://github.com/arlettebrook/preferred-domain-manager'",
  "class=\"github-mark\"",
  "telegram-credentials",
  "cron-settings-card>.check input:checked",
  "Token 已配置",
  "id=\"preferredDomain\"",
  "手动同步只更新 ",
  "'/api/sync?domainId='+encodeURIComponent(targetId)",
  "同步优选 IP 到 '+target.domain",
  "activeDomainStorageKey='preferred-domain-manager.active-domain-id'",
  "localStorage.getItem(activeDomainStorageKey)",
  "executionPanel?.remove()",
  "preferred-action-card",
  "auto-sync-enabled",
  "自动优选同步",
  "自动同步域名：",
]) {
  if (!source.includes(marker)) throw new Error(`管理页缺少 UI 修复标记：${marker}`);
}
const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1].replace(/\$\{adminLayoutScript\}/g, ""));

if (!scripts.length) throw new Error("无法找到管理页内嵌脚本");
scripts.forEach((script) => new Function(script));

const layoutFile = new URL("../src/ui/admin-layout.ts", import.meta.url);
const layoutSource = readFileSync(layoutFile, "utf8");
for (const marker of [
  "#settings.page.active{grid-template-columns:repeat(2,minmax(0,1fr))",
  "#settings>.page-head,#settings>.domain-profiles-card,#settings>.home-redirect-card,#settings>.telegram-settings-card{grid-column:1/-1}",
  "@media(max-width:820px){#settings.page.active{grid-template-columns:minmax(0,1fr)}",
]) {
  if (!layoutSource.includes(marker)) throw new Error(`管理台布局缺少全局设置修复标记：${marker}`);
}
const layoutMatch = layoutSource.match(/String\.raw`([\s\S]*)`;\s*$/);
if (!layoutMatch) throw new Error("无法找到管理台布局脚本");
new Function(layoutMatch[1]);
const pagesFile = new URL("../src/ui/pages.ts", import.meta.url);
const pagesSource = readFileSync(pagesFile, "utf8");
for (const marker of [
  "#settings.page.active{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))",
  "#settings.page.active>.domain-profiles-card,#settings.page.active>.home-redirect-card,#settings.page.active>.telegram-settings-card{grid-column:1/-1}",
  "#settings.page.active>.admin-path-card,#settings.page.active>.cron-settings-card{grid-column:auto}",
  "@media(max-width:980px){#settings.page.active",
]) {
  if (!pagesSource.includes(marker)) throw new Error(`管理页入口缺少全局设置修复标记：${marker}`);
}
const landingFile = new URL("../src/ui/landing-page.ts", import.meta.url);
const landingSource = readFileSync(landingFile, "utf8");
for (const marker of [
  'rel="icon" href="/favicon.svg"',
  'id="hero-title"',
  'id="capabilities"',
  'class="preview"',
  'class="feature-grid"',
  'https://github.com/arlettebrook/preferred-domain-manager',
  'class="github-mark"',
  'class="admin-icon"',
  '.header-action .admin-icon{display:block}',
  'viewport-fit=cover',
  'overflow-x:clip',
  '.hero{grid-template-columns:minmax(0,1fr)',
  'aria-label="打开 GitHub 项目"',
  '@media(prefers-reduced-motion:reduce)',
  'escapeHtml(adminPath)',
]) {
  if (!landingSource.includes(marker)) throw new Error(`默认主页缺少增强标记：${marker}`);
}
const faviconFile = new URL("../src/ui/favicon.ts", import.meta.url);
const faviconSource = readFileSync(faviconFile, "utf8");
for (const marker of ['viewBox="0 0 64 64"', '#6b82ff', '#956fff', '>优</text>']) {
  if (!faviconSource.includes(marker)) throw new Error(`网站图标缺少品牌标记：${marker}`);
}
const mainFile = new URL("../src/main.ts", import.meta.url);
const mainSource = readFileSync(mainFile, "utf8");
for (const marker of ['url.pathname === "/favicon.svg"', 'url.pathname === "/favicon.ico"', '"content-type": "image/svg+xml; charset=utf-8"']) {
  if (!mainSource.includes(marker)) throw new Error(`网站图标路由缺少标记：${marker}`);
}
console.log(`Embedded admin scripts syntax: ok (${scripts.length + 1})`);
