type UiPage = "landing" | "admin";

const redesignCss = String.raw`
:root {
  --ui-ink: #f4f7ff;
  --ui-muted: #8c99b2;
  --ui-faint: #66738b;
  --ui-bg: #080b13;
  --ui-bg-raised: #0d1220;
  --ui-panel: #111827;
  --ui-panel-soft: #151e30;
  --ui-line: #25314a;
  --ui-line-strong: #364663;
  --ui-primary: #7588ff;
  --ui-primary-strong: #91a0ff;
  --ui-primary-soft: #7588ff1c;
  --ui-cyan: #5ed9dd;
  --ui-success: #54d9a4;
  --ui-danger: #f1849a;
  --ui-warning: #edc46a;
  --ui-shadow: 0 24px 70px #00000035;
}

body {
  color: var(--ui-ink);
  background-color: var(--ui-bg);
  background-image:
    linear-gradient(#ffffff05 1px, transparent 1px),
    linear-gradient(90deg, #ffffff05 1px, transparent 1px),
    radial-gradient(circle at 15% -10%, #7588ff22, transparent 34%),
    radial-gradient(circle at 100% 10%, #5ed9dd12, transparent 26%);
  background-size: 32px 32px, 32px 32px, auto, auto;
}

body.light {
  --ui-ink: #18243a;
  --ui-muted: #60708a;
  --ui-faint: #8996ab;
  --ui-bg: #f5f7fb;
  --ui-bg-raised: #eef2f8;
  --ui-panel: #ffffff;
  --ui-panel-soft: #f7f9fd;
  --ui-line: #dce3ef;
  --ui-line-strong: #c5d0e1;
  --ui-primary: #4969d8;
  --ui-primary-strong: #3153c2;
  --ui-primary-soft: #4969d817;
  --ui-shadow: 0 20px 55px #34466e14;
  background-image:
    linear-gradient(#4969d008 1px, transparent 1px),
    linear-gradient(90deg, #4969d008 1px, transparent 1px),
    radial-gradient(circle at 15% -10%, #4969d817, transparent 34%),
    radial-gradient(circle at 100% 10%, #5ed9dd0c, transparent 26%);
}

button, input, textarea, select { font-family: inherit; }
button { min-height: 42px; border-radius: 12px; font-weight: 700; letter-spacing: .005em; }
button:not(.secondary):not(.danger) {
  background: linear-gradient(135deg, var(--ui-primary), #8069ee);
  box-shadow: 0 10px 24px #7588ff2b;
}
button:not(.secondary):not(.danger):hover { box-shadow: 0 13px 28px #7588ff45; }
button.secondary { background: var(--ui-panel-soft); border-color: var(--ui-line); }
button.secondary:hover { background: var(--ui-primary-soft); border-color: var(--ui-line-strong); }
button.ui-pressed { transform: scale(.98) !important; }
input, textarea, select { background: var(--ui-bg-raised); border-color: var(--ui-line); border-radius: 12px; }
input:focus, textarea:focus, select:focus { border-color: var(--ui-primary); box-shadow: 0 0 0 4px var(--ui-primary-soft); }

.layout { grid-template-columns: 264px minmax(0, 1fr); }
.sidebar {
  padding: 24px 16px;
  background: color-mix(in srgb, var(--ui-panel) 86%, transparent);
  border-right-color: var(--ui-line);
}
.brand { padding: 4px 10px 34px; gap: 12px; color: var(--ui-ink); }
.brand > span:last-child { line-height: 1.25; }
.brand .brand-mark, .login .brand-mark {
  background: linear-gradient(135deg, var(--ui-primary), #826be9 58%, var(--ui-cyan));
  box-shadow: 0 12px 28px #7588ff3b;
}
.nav { gap: 8px; }
.nav button { min-height: 46px; border-radius: 13px; }
.nav button.active { background: linear-gradient(135deg, #7588ffe8, #7864e7dd); box-shadow: 0 12px 24px #7588ff26; }
.nav-icon { width: 26px; }

.topbar {
  min-height: 82px;
  padding: 0 42px;
  background: color-mix(in srgb, var(--ui-bg) 76%, transparent);
  border-bottom-color: var(--ui-line);
}
.topbar h1 { font-size: 20px; }
.top-actions { gap: 10px; }
.main { width: min(1460px, 100%); padding: 38px 42px 72px; }
.page-head { margin-bottom: 26px; }
.page-kicker { color: var(--ui-cyan); letter-spacing: .12em; text-transform: uppercase; }
.page-kicker:before { box-shadow: 0 0 0 5px #5ed9dd1b; }
.page-head h2 { font-size: clamp(28px, 3vw, 38px); }
.page-head p, .card p { color: var(--ui-muted); }

.dashboard-grid { gap: 20px; }
.card {
  position: relative;
  overflow: hidden;
  padding: 24px;
  border-color: var(--ui-line);
  border-radius: 20px;
  background: linear-gradient(145deg, color-mix(in srgb, var(--ui-panel) 96%, transparent), var(--ui-panel-soft));
  box-shadow: var(--ui-shadow);
}
.card:before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 1px;
  background: linear-gradient(90deg, transparent, #7588ff88, transparent);
  opacity: .7;
}
.card:hover { border-color: var(--ui-line-strong); }
.section-icon {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  color: var(--ui-primary-strong);
  background: linear-gradient(145deg, var(--ui-primary-soft), #5ed9dd12);
  border-color: #7588ff38;
}
.section-head { margin-bottom: 20px; }
.section-head h3 { font-size: 18px; }
.section-head p { max-width: 720px; }
.metrics { gap: 12px; }
.metric { padding: 17px; border-color: var(--ui-line); border-radius: 15px; background: var(--ui-bg-raised); }
.metric strong { font-size: 28px; }
.metric:after { background: linear-gradient(135deg, var(--ui-primary-soft), #5ed9dd12); }
.toolbar { margin-bottom: 16px; }
.table-wrap { border-color: var(--ui-line); border-radius: 15px; }
.table th { background: var(--ui-bg-raised); color: var(--ui-faint); }
.table th, .table td { padding: 14px 15px; }
.table tbody tr:hover { background: var(--ui-primary-soft); }
.badge { border-color: var(--ui-line); background: var(--ui-bg-raised); }
.badge.managed { color: var(--ui-primary-strong); border-color: #7588ff55; background: var(--ui-primary-soft); }
.meta-chip { border-radius: 999px; padding: 4px 9px; background: var(--ui-bg-raised); color: var(--ui-muted); }
.meta-chip.active { color: var(--ui-success); background: #54d9a416; }
.output { border: 1px solid var(--ui-line); border-radius: 14px; }
.ui-dirty-banner {
  display: none;
  align-items: center;
  gap: 7px;
  margin-left: auto;
  padding: 7px 10px;
  color: var(--ui-warning);
  border: 1px solid #edc46a44;
  border-radius: 999px;
  background: #edc46a12;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.ui-dirty-banner.visible { display: inline-flex; }
.ui-dirty-banner:before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 4px #edc46a22; }
.ui-setup-guide {
  display: none;
  position: relative;
  gap: 16px;
  align-items: center;
  margin: 0 0 20px;
  padding: 18px 20px;
  border: 1px solid #5ed9dd44;
  border-radius: 18px;
  background: linear-gradient(100deg, #5ed9dd12, var(--ui-primary-soft));
}
.ui-setup-guide.visible { display: flex; }
.ui-setup-guide-copy { min-width: 0; flex: 1; }
.ui-setup-guide h3 { margin: 0 0 4px; font-size: 16px; }
.ui-setup-guide p { margin: 0; color: var(--ui-muted); font-size: 13px; }
.ui-setup-guide .actions { flex: none; }
.ui-health-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: -8px 0 22px;
}
.ui-health-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  color: var(--ui-muted);
  border: 1px solid var(--ui-line);
  border-radius: 999px;
  background: var(--ui-panel-soft);
  font-size: 12px;
}
.ui-health-chip:before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--ui-faint); }
.ui-health-chip.ok { color: var(--ui-success); border-color: #54d9a444; background: #54d9a410; }
.ui-health-chip.ok:before { background: currentColor; box-shadow: 0 0 0 4px #54d9a41c; }
.ui-health-chip.warn { color: var(--ui-warning); border-color: #edc46a44; background: #edc46a10; }
.ui-health-chip.warn:before { background: currentColor; }
.ui-config-tools { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.ui-config-tools input { display: none; }
.ui-history-panel { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--ui-line); }
.ui-history-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.ui-history-head strong { font-size: 13px; }
.ui-history-head button { min-height: 34px; padding: 6px 10px; font-size: 12px; }
.ui-history-list { display: grid; gap: 7px; }
.ui-history-item { display: flex; align-items: center; gap: 10px; justify-content: space-between; padding: 10px 11px; border: 1px solid var(--ui-line); border-radius: 12px; background: var(--ui-bg-raised); }
.ui-history-copy { min-width: 0; display: grid; gap: 2px; }
.ui-history-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.ui-history-copy span { color: var(--ui-faint); font-size: 11px; }
.ui-history-item button { flex: none; min-height: 32px; padding: 5px 9px; font-size: 11px; }

.login {
  width: min(460px, 100%);
  padding: 36px;
  border-color: #7588ff52;
  border-radius: 24px;
  background: linear-gradient(145deg, color-mix(in srgb, var(--ui-panel) 96%, transparent), var(--ui-panel-soft));
  box-shadow: var(--ui-shadow);
}
.login:before { background: radial-gradient(circle, #7588ff26, transparent 68%); }
.login-brand { margin-bottom: 30px; }
.login h1 { font-size: 26px; }
.login p { color: var(--ui-muted); }
.dialog { border-color: var(--ui-line-strong); border-radius: 22px; box-shadow: 0 30px 100px #00000066; }
.dialog::backdrop { background: #040711b8; }
.toast { border-color: var(--ui-line-strong); border-radius: 15px; background: var(--ui-panel); }

.landing-card {
  padding: clamp(32px, 7vw, 72px);
  border-color: #7588ff54;
  border-radius: 30px;
  background: linear-gradient(145deg, #111929f2, #0c1220f8);
  box-shadow: 0 30px 100px #00000040;
}
.landing-card:after { background: radial-gradient(circle, #5ed9dd2b, transparent 68%); }
.landing-card h1 { max-width: 670px; font-size: clamp(34px, 6vw, 58px); }
.landing-card p { color: var(--ui-muted); font-size: 17px; line-height: 1.8; }
.feature { border-color: var(--ui-line); background: #ffffff08; border-radius: 999px; }

@media (max-width: 1050px) {
  .topbar { padding: 0 24px; }
  .main { padding: 30px 24px 58px; }
}
@media (max-width: 640px) {
  .topbar { min-height: 70px; padding: 10px 14px !important; }
  .main { padding: 24px 14px 44px; }
  .page-head h2 { font-size: 28px; }
  .card { padding: 19px; border-radius: 17px; }
  .login { padding: 28px 22px; }
  .landing-card { padding: 30px 24px; border-radius: 24px; }
  .landing-card h1 { font-size: 36px; }
  .landing-card p { font-size: 15px; }
  .ui-dirty-banner { position: absolute; top: 76px; left: 14px; margin: 0; }
  .ui-setup-guide.visible { display: block; }
  .ui-setup-guide .actions { margin-top: 13px; }
  .ui-health-strip { margin-top: -4px; }
  .ui-config-tools button { flex: 1; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; }
}
`;

const polishScript = String.raw`
<script>
(() => {
  document.documentElement.dataset.ui = "polished";
  document.querySelectorAll(".card").forEach((card) => card.setAttribute("data-ui-card", "true"));
  document.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    button.classList.add("ui-pressed");
    window.setTimeout(() => button.classList.remove("ui-pressed"), 180);
  }, { passive: true }));

  const app = document.querySelector("#app");
  if (!app) return;

  const dashboard = document.querySelector("#dashboard");
  const domainStatus = document.querySelector("#domainStatus");
  if (dashboard && domainStatus) {
    const guide = document.createElement("section");
    guide.className = "ui-setup-guide";
    guide.innerHTML = '<div class="ui-setup-guide-copy"><h3>先完成基础配置</h3><p>添加域名、Cloudflare Zone ID 和 API Token 后，才能读取 DNS 记录并执行同步。</p></div><div class="actions"><button type="button" class="secondary ui-open-settings">去设置</button></div>';
    dashboard.insertBefore(guide, dashboard.firstElementChild);
    const updateGuide = () => guide.classList.toggle("visible", /尚未配置/.test(domainStatus.textContent || ""));
    new MutationObserver(updateGuide).observe(domainStatus, { childList: true, characterData: true, subtree: true });
    updateGuide();
    guide.querySelector(".ui-open-settings")?.addEventListener("click", () => {
      document.querySelector('[data-page="settings"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      window.setTimeout(() => document.querySelector("#domainProfiles input")?.focus(), 80);
    });
  }

  let dirty = false;
  const banner = document.createElement("span");
  banner.className = "ui-dirty-banner";
  banner.textContent = "有未保存修改";
  const actions = document.querySelector(".top-actions");
  if (actions?.parentElement) actions.parentElement.insertBefore(banner, actions);

  const updateDirtyState = (next) => {
    dirty = next;
    banner.classList.toggle("visible", dirty);
    window.document.title = dirty ? "* 优选域名管理面板" : "优选域名管理面板";
  };
  const markDirty = (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) updateDirtyState(true);
  };
  app.addEventListener("input", markDirty, true);
  app.addEventListener("change", markDirty, true);
  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  const nativeFetch = window.fetch.bind(window);
  let refreshHealth = async () => {};
  let refreshHistory = async () => {};
  window.fetch = async (input, init = {}) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await nativeFetch(input, { ...init, signal: init.signal || controller.signal });
      const url = typeof input === "string" ? input : input.url;
      if (response.ok && url.includes("/api/config") && (init.method || "GET").toUpperCase() === "PUT") updateDirtyState(false);
      if (response.ok && url.includes("/api/sync")) refreshHealth();
      if (response.ok && url.includes("/api/dns/records") && (init.method || "GET").toUpperCase() !== "GET") refreshHistory();
      return response;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("请求超时，请稍后重试");
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const healthStrip = document.createElement("div");
  healthStrip.className = "ui-health-strip";
  const pageHead = document.querySelector("#dashboard .page-head");
  pageHead?.after(healthStrip);
  const renderHealth = (health) => {
    const sync = health.sync;
    const syncText = sync
      ? (sync.ok ? "上次同步 " + new Date(sync.at).toLocaleString() : "上次同步有 " + sync.failed + " 个域名失败")
      : "尚未执行同步";
    healthStrip.innerHTML = [
      "<span class=\"ui-health-chip " + (health.ready ? "ok" : "warn") + "\">" + (health.ready ? "域名配置已就绪" : "等待完成域名配置") + "</span>",
      "<span class=\"ui-health-chip\">" + health.domains.length + " 个域名 · " + health.ipSources + " 个 IP 来源</span>",
      "<span class=\"ui-health-chip " + (sync?.ok ? "ok" : "") + "\">" + syncText + "</span>",
    ].join("");
  };
  refreshHealth = async () => {
    try {
      const response = await window.fetch("/api/health");
      if (response.ok) renderHealth(await response.json());
    } catch {}
  };
  const appObserver = new MutationObserver(() => {
    if (!app.classList.contains("hidden")) refreshHealth();
  });
  appObserver.observe(app, { attributes: true, attributeFilter: ["class"] });
  if (!app.classList.contains("hidden")) refreshHealth();

  const dnsCard = document.querySelector("#dashboard .dashboard-grid > .card");
  if (dnsCard) {
    const historyPanel = document.createElement("section");
    historyPanel.className = "ui-history-panel";
    historyPanel.innerHTML = '<div class="ui-history-head"><strong>DNS 操作历史</strong><button type="button" class="secondary ui-refresh-history">刷新</button></div><div class="ui-history-list"><p class="hint">正在加载历史记录…</p></div>';
    dnsCard.append(historyPanel);
    const historyList = historyPanel.querySelector(".ui-history-list");
    const query = () => { const domainId = document.querySelector("#dnsDomain")?.value; return domainId ? "?domainId=" + encodeURIComponent(domainId) : ""; };
    const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character] || character));
    refreshHistory = async () => {
      try {
        const response = await window.fetch("/api/dns/history" + query());
        if (!response.ok) return;
        const data = await response.json();
        const entries = data.history || [];
        historyList.innerHTML = entries.length ? entries.slice(0, 8).map((entry) => '<div class="ui-history-item"><div class="ui-history-copy"><strong>' + escape(entry.summary) + '</strong><span>' + escape(new Date(entry.at).toLocaleString()) + ' · ' + escape(entry.action) + ' · ' + entry.beforeCount + ' → ' + entry.afterCount + ' 条</span></div><button type="button" class="secondary ui-rollback" data-history-id="' + escape(entry.id) + '">回滚</button></div>').join("") : '<p class="hint">暂无 DNS 操作历史。</p>';
      } catch {}
    };
    historyPanel.querySelector(".ui-refresh-history")?.addEventListener("click", refreshHistory);
    historyPanel.addEventListener("click", async (event) => {
      const button = event.target.closest(".ui-rollback");
      if (!button || !window.confirm("确定回滚这次 DNS 操作吗？当前可管理记录会恢复到操作前状态。")) return;
      button.disabled = true;
      try {
        const response = await window.fetch("/api/dns/history/" + encodeURIComponent(button.dataset.historyId) + "/rollback" + query(), { method: "POST" });
        if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "DNS 回滚失败"); }
        await refreshHistory();
        document.querySelector("#refreshDns")?.click();
      } catch (error) { window.alert(error instanceof Error ? error.message : "DNS 回滚失败"); }
      finally { button.disabled = false; }
    });
    document.querySelector("#dnsDomain")?.addEventListener("change", refreshHistory);
    if (!app.classList.contains("hidden")) refreshHistory();
  }

  const settings = document.querySelector("#settings");
  if (settings) {
    const tools = document.createElement("div");
    tools.className = "ui-config-tools";
    tools.innerHTML = '<button type="button" class="secondary ui-export-config">导出脱敏配置</button><button type="button" class="secondary ui-import-config">导入配置</button><input type="file" accept="application/json,.json" class="ui-import-file">';
    settings.querySelector(".page-head")?.append(tools);
    const fileInput = tools.querySelector(".ui-import-file");
    tools.querySelector(".ui-export-config")?.addEventListener("click", async () => {
      try {
        const response = await window.fetch("/api/config");
        if (!response.ok) throw new Error("配置读取失败");
        const data = await response.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "preferred-domain-config-" + new Date().toISOString().slice(0, 10) + ".json";
        link.click();
        URL.revokeObjectURL(link.href);
      } catch (error) { window.alert(error instanceof Error ? error.message : "配置导出失败"); }
    });
    tools.querySelector(".ui-import-config")?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const imported = JSON.parse(await file.text());
        if (!imported || typeof imported !== "object" || !Array.isArray(imported.domains)) throw new Error("配置文件格式无效");
        const allowed = (({ ipSources, manualIps, domains, adminPath, defaultDomain, cfZoneId, telegramAllowedUserIds }) => ({ ipSources, manualIps, domains, adminPath, defaultDomain, cfZoneId, telegramAllowedUserIds }))(imported);
        const response = await window.fetch("/api/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(allowed) });
        if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "配置导入失败"); }
        window.location.reload();
      } catch (error) { window.alert(error instanceof Error ? error.message : "配置导入失败"); }
      fileInput.value = "";
    });
  }
})();
</script>`;

export function applyUiRedesign(html: string, page: UiPage): string {
  const marker = page === "admin" ? "admin" : "landing";
  return html
    .replace("</head>", `<style id="pdm-${marker}-redesign">${redesignCss}</style></head>`)
    .replace("</body>", `${polishScript}</body>`);
}
