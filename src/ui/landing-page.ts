import { escapeHtml } from "../validation";

export function landingPage(host: string, adminPath = "/admin") {
  const safeHost = escapeHtml(host);
  const safeAdminPath = escapeHtml(adminPath);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#08101f">
<meta name="description" content="Preferred Domain Manager：集中管理 Cloudflare DNS、优选 IP、自动同步与 Telegram Bot。">
<title>优选域名管理</title>
<style>
:root{color-scheme:dark;--bg:#070e1b;--panel:#0f1a2d;--panel-strong:#14223a;--soft:#101d32;--text:#f3f6ff;--muted:#93a4c0;--muted-2:#7183a1;--border:#253957;--border-strong:#385078;--primary:#7187ff;--primary-2:#956fff;--primary-soft:#7187ff1a;--ok:#51d6a3;--shadow:0 28px 90px #0007;--radius:24px}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;min-width:320px;min-height:100vh;overflow-x:hidden;background:radial-gradient(circle at 7% -4%,#526dff25,transparent 30%),radial-gradient(circle at 96% 12%,#935eff1a,transparent 27%),var(--bg);color:var(--text);font:15px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.32;background-image:linear-gradient(#fff018 1px,transparent 1px),linear-gradient(90deg,#fff018 1px,transparent 1px);background-size:54px 54px;mask-image:linear-gradient(to bottom,#000,transparent 70%)}
a{color:inherit}
.shell{position:relative;width:min(1180px,calc(100% - 40px));margin:0 auto}
.site-header{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;min-height:82px;border-bottom:1px solid #ffffff12;background:linear-gradient(180deg,#070e1bea 72%,#070e1bba);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.brand{display:inline-flex;align-items:center;gap:12px;color:var(--text);font-weight:780;letter-spacing:-.02em;text-decoration:none}
.brand-mark{display:grid;place-items:center;width:38px;height:38px;border:1px solid #9cafff55;border-radius:12px;background:linear-gradient(135deg,var(--primary),var(--primary-2));box-shadow:0 10px 28px #7187ff3d;font-size:17px;font-weight:850}
.brand-copy{display:grid;line-height:1.15}.brand-copy small{margin-top:4px;color:var(--muted-2);font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.header-actions{display:flex;align-items:center;gap:8px;padding:4px;border:1px solid #ffffff0c;border-radius:15px;background:#091322a8;box-shadow:0 10px 30px #0002}.header-action{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:9px 13px;border:1px solid transparent;border-radius:11px;background:transparent;color:#c8d3e8;font-size:13px;font-weight:730;text-decoration:none;transition:transform .18s ease,background .18s ease,border-color .18s ease,color .18s ease,box-shadow .18s ease}.header-action svg{flex:none;width:17px;height:17px;fill:currentColor;transition:transform .18s ease}.header-action.github-action{border-color:#445a7f;background:#ffffff07}.header-action.admin-action{border-color:#8496ff38;background:linear-gradient(135deg,#7187ff26,#956fff1c);color:#eef1ff}.header-action:hover{border-color:#647ca7;background:#ffffff0d;color:#fff;transform:translateY(-1px);box-shadow:0 8px 22px #0003}.header-action.github-action:hover svg{transform:scale(1.08) rotate(-4deg)}.header-action.admin-action:hover{border-color:#8496ff7a;background:linear-gradient(135deg,#7187ff42,#956fff30);box-shadow:0 8px 24px #7187ff20}.external-mark{color:#93a5c5;font-size:12px;transition:transform .18s ease}.header-action:hover .external-mark{transform:translate(1px,-1px)}
.hero{display:grid;grid-template-columns:minmax(0,1.04fr) minmax(420px,.96fr);align-items:center;gap:70px;min-height:650px;padding:78px 0 84px}
.eyebrow{display:inline-flex;align-items:center;gap:9px;margin-bottom:22px;color:#b3bfff;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
.eyebrow:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 5px #51d6a31a}
.hero h1{max-width:670px;margin:0;font-size:clamp(42px,5.6vw,72px);line-height:1.05;letter-spacing:-.055em}
.gradient-text{color:transparent;background:linear-gradient(100deg,#f4f7ff 2%,#aab8ff 53%,#be9bff);background-clip:text;-webkit-background-clip:text}
.hero-description{max-width:620px;margin:25px 0 0;color:var(--muted);font-size:clamp(16px,1.7vw,19px);line-height:1.8}
.host-line{display:inline-flex;align-items:center;gap:8px;max-width:100%;margin-top:19px;padding:7px 11px;border:1px solid var(--border);border-radius:10px;background:#ffffff06;color:var(--muted);font-size:12px}.host-line:before{content:"";flex:none;width:7px;height:7px;border-radius:50%;background:var(--ok)}.host-line strong{overflow:hidden;color:#dce5f7;text-overflow:ellipsis;white-space:nowrap}
.hero-actions{display:flex;flex-wrap:wrap;gap:11px;margin-top:30px}
.button{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:48px;padding:11px 18px;border:1px solid var(--border);border-radius:13px;background:#ffffff08;color:#e7edfa;font-weight:760;text-decoration:none;transition:.2s ease}
.button.primary{border-color:transparent;background:linear-gradient(135deg,var(--primary),var(--primary-2));color:#fff;box-shadow:0 13px 34px #7187ff35}.button.primary:hover{transform:translateY(-2px);box-shadow:0 17px 38px #7187ff50}.button.secondary:hover{border-color:var(--border-strong);background:#ffffff0d}
.trust-row{display:flex;flex-wrap:wrap;gap:18px;margin-top:31px;color:var(--muted-2);font-size:12px;font-weight:650}.trust-row span{display:inline-flex;align-items:center;gap:7px}.trust-row span:before{content:"✓";display:grid;place-items:center;width:17px;height:17px;border-radius:50%;background:#51d6a315;color:var(--ok);font-size:10px}
.preview-wrap{position:relative}.preview-wrap:before{content:"";position:absolute;inset:10% -8%;border-radius:50%;background:#7187ff26;filter:blur(70px)}
.preview{position:relative;overflow:hidden;border:1px solid #50678f88;border-radius:22px;background:linear-gradient(155deg,#152440f2,#0d1729f7);box-shadow:var(--shadow);transform:perspective(1100px) rotateY(-3deg) rotateX(1deg)}
.preview-bar{display:flex;align-items:center;justify-content:space-between;padding:15px 17px;border-bottom:1px solid var(--border);background:#ffffff05}.preview-title{display:flex;align-items:center;gap:9px;font-size:12px;font-weight:750}.window-dots{display:flex;gap:5px}.window-dots i{width:7px;height:7px;border-radius:50%;background:#53637d}.window-dots i:first-child{background:#7187ff}.preview-status{display:inline-flex;align-items:center;gap:6px;color:var(--ok);font-size:10px;font-weight:750}.preview-status:before{content:"";width:6px;height:6px;border-radius:50%;background:var(--ok);box-shadow:0 0 10px var(--ok)}
.preview-body{padding:18px}.preview-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.metric{padding:13px;border:1px solid var(--border);border-radius:12px;background:#ffffff05}.metric span{display:block;color:var(--muted-2);font-size:9px;font-weight:750;letter-spacing:.06em}.metric strong{display:block;margin-top:4px;font-size:20px;letter-spacing:-.03em}.metric strong em{color:var(--ok);font-size:10px;font-style:normal;font-weight:700}
.record-panel{margin-top:11px;padding:14px;border:1px solid var(--border);border-radius:14px;background:#08132480}.panel-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.panel-head strong{font-size:11px}.panel-head span{color:var(--muted-2);font-size:9px}.record{display:grid;grid-template-columns:47px minmax(0,1fr) auto;align-items:center;gap:10px;padding:10px 8px;border-top:1px solid #ffffff0b;font-size:10px}.record:first-of-type{border-top:0}.record-type{display:inline-flex;justify-content:center;padding:3px 6px;border-radius:6px;background:var(--primary-soft);color:#a9b7ff;font-size:9px;font-weight:800}.record-copy{min-width:0}.record-copy strong,.record-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.record-copy strong{font-size:10px}.record-copy span{color:var(--muted-2);font-size:9px}.record-state{display:inline-flex;align-items:center;gap:5px;color:var(--ok);font-size:9px}.record-state:before{content:"";width:5px;height:5px;border-radius:50%;background:var(--ok)}
.sync-card{display:flex;align-items:center;gap:12px;margin-top:11px;padding:12px 14px;border:1px solid #7187ff40;border-radius:13px;background:linear-gradient(90deg,#7187ff18,#956fff0b)}.sync-icon{display:grid;place-items:center;flex:none;width:31px;height:31px;border-radius:9px;background:#7187ff25;color:#aebaff}.sync-copy{display:grid;min-width:0}.sync-copy strong{font-size:10px}.sync-copy span{color:var(--muted-2);font-size:9px}.sync-progress{margin-left:auto;color:#aebaff;font-size:10px;font-weight:800}
.section{padding:32px 0 92px}.section-head{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:28px}.section-label{color:#9baaff;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.section h2{max-width:610px;margin:8px 0 0;font-size:clamp(28px,4vw,42px);line-height:1.2;letter-spacing:-.04em}.section-head p{max-width:420px;margin:0;color:var(--muted);font-size:14px}
.feature-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.feature-card{position:relative;overflow:hidden;min-height:225px;padding:24px;border:1px solid var(--border);border-radius:18px;background:linear-gradient(150deg,#111e33d9,#0d1728c7);transition:.2s ease}.feature-card:hover{border-color:#526b99;transform:translateY(-3px)}.feature-card:after{content:"";position:absolute;width:120px;height:120px;right:-60px;bottom:-70px;border-radius:50%;background:#7187ff18;filter:blur(8px)}.feature-icon{display:grid;place-items:center;width:40px;height:40px;margin-bottom:24px;border:1px solid #7187ff3d;border-radius:12px;background:var(--primary-soft);color:#adbbff;font-size:17px}.feature-card h3{margin:0 0 9px;font-size:17px}.feature-card p{margin:0;color:var(--muted);font-size:13px;line-height:1.75}.feature-meta{display:block;margin-top:20px;color:#7f91ad;font-size:10px;font-weight:750;letter-spacing:.06em;text-transform:uppercase}
.cta{display:flex;align-items:center;justify-content:space-between;gap:28px;margin-bottom:34px;padding:34px 38px;border:1px solid #526fd166;border-radius:22px;background:linear-gradient(120deg,#152541,#111b30 58%,#20183c);box-shadow:0 20px 55px #0003}.cta h2{margin:0 0 7px;font-size:clamp(23px,3vw,32px);letter-spacing:-.035em}.cta p{margin:0;color:var(--muted);font-size:13px}
.site-footer{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 0 35px;color:var(--muted-2);font-size:11px}.footer-brand{display:flex;align-items:center;gap:8px;font-weight:700}.footer-dot{width:6px;height:6px;border-radius:50%;background:var(--ok)}
a:focus-visible{outline:2px solid #aab7ff;outline-offset:4px}
@media(max-width:920px){.hero{grid-template-columns:1fr;gap:50px;min-height:0;padding:65px 0 75px}.hero-copy{max-width:760px}.preview-wrap{width:min(620px,100%);margin:auto}.preview{transform:none}.feature-grid{grid-template-columns:1fr 1fr}.feature-card:last-child{grid-column:1/-1}.section-head{align-items:start;flex-direction:column}.section-head p{max-width:600px}}
@media(max-width:640px){.shell{width:min(100% - 28px,1180px)}.site-header{min-height:68px}.brand-copy small{display:none}.header-actions{padding:3px;border-radius:13px}.header-action{padding:8px 10px;font-size:12px}.hero{gap:40px;padding:48px 0 60px}.hero h1{font-size:clamp(37px,12vw,52px)}.hero-description{font-size:15px}.hero-actions{display:grid;grid-template-columns:1fr}.button{width:100%}.trust-row{gap:10px 16px;margin-top:24px}.preview-body{padding:12px}.preview-metrics{gap:6px}.metric{padding:10px}.metric strong{font-size:16px}.record{grid-template-columns:42px minmax(0,1fr);gap:7px;padding:9px 5px}.record-state{display:none}.sync-card{padding:10px}.section{padding:15px 0 65px}.feature-grid{grid-template-columns:1fr}.feature-card,.feature-card:last-child{grid-column:auto;min-height:0;padding:21px}.feature-icon{margin-bottom:18px}.cta{align-items:stretch;flex-direction:column;padding:26px 22px}.site-footer{align-items:flex-start;flex-direction:column-reverse;gap:8px}}
@media(max-width:440px){.header-actions{gap:4px}.header-action{width:40px;padding:8px}.header-action .action-label,.header-action .external-mark{display:none}.preview-metrics{grid-template-columns:1fr}.metric:nth-child(n+2){display:none}.host-line{width:100%}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{transition-duration:.01ms!important}}
</style>
</head>
<body>
<div class="shell">
  <header class="site-header">
    <a class="brand" href="/" aria-label="优选域名管理首页">
      <span class="brand-mark">优</span>
      <span class="brand-copy">优选域名管理<small>Preferred Domain Manager</small></span>
    </a>
    <div class="header-actions">
      <a class="header-action github-action" href="https://github.com/arlettebrook/preferred-domain-manager" target="_blank" rel="noopener noreferrer" aria-label="打开 GitHub 开源项目"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .8a11.4 11.4 0 0 0-3.6 22.2c.6.1.8-.2.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.1 1.2a10.8 10.8 0 0 1 5.7-.8 10.8 10.8 0 0 1 5.7.8c2.2-1.5 3.1-1.2 3.1-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.8 5.4-5.5 5.7.4.4.8 1.1.8 2.1v3.1c0 .4.2.7.8.6A11.4 11.4 0 0 0 12 .8Z"/></svg><span class="action-label">GitHub 项目</span><span class="external-mark" aria-hidden="true">↗</span></a>
      <a class="header-action admin-action" href="${safeAdminPath}" aria-label="进入管理控制台"><span class="action-label">管理控制台</span><span class="external-mark" aria-hidden="true">→</span></a>
    </div>
  </header>

  <main>
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <div class="eyebrow">Cloudflare DNS Automation</div>
        <h1 id="hero-title">让域名解析始终指向<span class="gradient-text">更优的网络入口</span></h1>
        <p class="hero-description">集中管理 Cloudflare DNS、优选 IP 与自动同步任务。用更清晰的流程完成检测、筛选和更新，同时保留手动控制能力。</p>
        <div class="host-line">当前站点 <strong>${safeHost}</strong></div>
        <div class="hero-actions">
          <a class="button primary" href="${safeAdminPath}">进入管理控制台 <span aria-hidden="true">→</span></a>
          <a class="button secondary" href="#capabilities">了解核心能力</a>
        </div>
        <div class="trust-row" aria-label="核心特性">
          <span>DNS 自动同步</span><span>TCP 443 可用性检测</span><span>安全会话管理</span>
        </div>
      </div>

      <div class="preview-wrap" aria-label="管理控制台功能预览">
        <div class="preview">
          <div class="preview-bar">
            <div class="preview-title"><span class="window-dots"><i></i><i></i><i></i></span>运行概览</div>
            <span class="preview-status">服务就绪</span>
          </div>
          <div class="preview-body">
            <div class="preview-metrics">
              <div class="metric"><span>候选地址</span><strong>128</strong></div>
              <div class="metric"><span>检测可用</span><strong>36 <em>可同步</em></strong></div>
              <div class="metric"><span>托管域名</span><strong>03</strong></div>
            </div>
            <div class="record-panel">
              <div class="panel-head"><strong>DNS 记录</strong><span>最近同步</span></div>
              <div class="record"><span class="record-type">A</span><span class="record-copy"><strong>example.com</strong><span>优选 IPv4 地址</span></span><span class="record-state">已同步</span></div>
              <div class="record"><span class="record-type">AAAA</span><span class="record-copy"><strong>example.com</strong><span>优选 IPv6 地址</span></span><span class="record-state">已同步</span></div>
              <div class="record"><span class="record-type">CNAME</span><span class="record-copy"><strong>*.example.com</strong><span>泛域名自动配对</span></span><span class="record-state">正常</span></div>
            </div>
            <div class="sync-card"><span class="sync-icon">↯</span><span class="sync-copy"><strong>定时优选同步</strong><span>检测完成后自动更新 DNS</span></span><span class="sync-progress">30 min</span></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="capabilities" aria-labelledby="capabilities-title">
      <div class="section-head">
        <div><div class="section-label">Core Capabilities</div><h2 id="capabilities-title">从地址检测到 DNS 更新，一站式完成</h2></div>
        <p>围绕日常域名运维设计，减少重复操作，让每次同步都有明确的检测结果和可控的配置。</p>
      </div>
      <div class="feature-grid">
        <article class="feature-card"><span class="feature-icon">⌁</span><h3>多域名 DNS 管理</h3><p>统一维护多个 Cloudflare 域名，支持 A、AAAA 与 CNAME，并可自动配对主域名和泛域名记录。</p><span class="feature-meta">Cloudflare DNS</span></article>
        <article class="feature-card"><span class="feature-icon">↯</span><h3>优选 IP 检测与同步</h3><p>整合公开来源和手动地址，按地区筛选并进行 TCP 443 可用性检测，再将完整结果安全同步。</p><span class="feature-meta">Availability Check</span></article>
        <article class="feature-card"><span class="feature-icon">✈</span><h3>自动任务与远程操作</h3><p>使用定时任务持续更新解析，也可通过 Telegram Bot 查看和维护允许管理的域名记录。</p><span class="feature-meta">Automation</span></article>
      </div>
    </section>

    <section class="cta" aria-labelledby="cta-title">
      <div><h2 id="cta-title">准备开始管理你的域名？</h2><p>进入控制台完成 Cloudflare 域名、优选来源和自动任务配置。</p></div>
      <a class="button primary" href="${safeAdminPath}">打开管理控制台 <span aria-hidden="true">→</span></a>
    </section>
  </main>

  <footer class="site-footer"><span>根域名与泛域名均可绑定至当前 Worker。</span><span class="footer-brand"><i class="footer-dot"></i> Preferred Domain Manager</span></footer>
</div>
</body>
</html>`;
}
