import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const directory = mkdtempSync(join(tmpdir(), "preferred-domain-dns-"));
const require = createRequire(import.meta.url);
const originalFetch = globalThis.fetch;
try {
  function bundle(source) {
    const output = join(directory, source.replaceAll("/", "-") + ".cjs");
    execFileSync(process.execPath, [join("node_modules", "esbuild", "bin", "esbuild"), source, "--bundle", "--platform=node", "--format=cjs", "--alias:cloudflare:sockets=./scripts/cloudflare-sockets-shim.mjs", `--outfile=${output}`], { stdio: "ignore" });
    return require(output);
  }
  const dns = bundle("src/services/cloudflare-dns.ts");
  const { handleApi } = bundle("src/api.ts");
  const { createSession } = bundle("src/security/session.ts");
  const { adminPage } = bundle("src/ui/admin-page.ts");
  const { MANAGED_COMMENT } = bundle("src/config.ts");
  const zone = { domain: "example.com", zoneId: "zone-1", syncWildcard: false };
  let sequence = 0;
  const record = (name, type, content, extra = {}) => ({ id: (++sequence).toString(16).padStart(8, "0"), name, type, content, proxied: false, ...extra });
  let records = [];
  let requests = [];
  let rejectCleanup = false;
  let locked = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.cloudflare.com");
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ url, method, body, token: init.headers.authorization, locked });
    if (method === "GET") {
      const name = url.searchParams.get("name");
      const matching = name ? records.filter((item) => item.name.toLowerCase().replace(/\.$/, "") === name) : records;
      const size = Number(url.searchParams.get("per_page") || 100);
      const page = Number(url.searchParams.get("page") || 1);
      return Response.json({ success: true, result: matching.slice((page - 1) * size, page * size) });
    }
    if (url.pathname.endsWith("/batch")) {
      if (rejectCleanup) return Response.json({ success: false, errors: [{ message: "DNS delete denied" }] }, { status: 403 });
      records = records.filter((item) => !body.deletes.some((deleted) => deleted.id === item.id));
      for (const patch of body.patches) records = records.map((item) => item.id === patch.id ? { ...item, ...patch } : item);
      for (const post of body.posts) records.push(record(post.name, post.type, post.content, post));
      return Response.json({ success: true, result: {} });
    }
    if (method === "DELETE") {
      records = records.filter((item) => item.id !== url.pathname.split("/").at(-1));
      return Response.json({ success: true, result: {} });
    }
    if (method === "PUT") {
      const id = url.pathname.split("/").at(-1);
      records = records.map((item) => item.id === id ? { ...item, ...body } : item);
      return Response.json({ success: true, result: records.find((item) => item.id === id) });
    }
    assert.equal(method, "POST");
    const created = record(body.name, body.type, body.content, body);
    records.push(created);
    return Response.json({ success: true, result: created });
  };

  // Disabling removes both managed and manual wildcard address/alias records,
  // while preserving named subdomains, apex records, and unrelated record types.
  const retained = [record("example.com", "A", "1.1.1.1"), record("www.example.com", "CNAME", "origin.example.net"), record("*.example.com", "TXT", "verification"), record("*.example.com", "MX", "mail.example.net")];
  const wildcards = [record("*.example.com", "A", "2.2.2.2", { comment: MANAGED_COMMENT }), record("*.example.com", "AAAA", "2606:4700:4700::1111"), record("*.example.com", "CNAME", "origin.example.net")];
  records = [...retained, ...wildcards];
  assert.equal(await dns.clearWildcardDnsRecords(zone, {}, "token"), 3);
  assert.deepEqual(records, retained);
  assert.equal(await dns.clearWildcardDnsRecords(zone, {}, "token"), 0);
  records = [...retained, ...Array.from({ length: 1001 }, () => record("*.example.com", "A", "2.2.2.2"))];
  assert.equal(await dns.clearWildcardDnsRecords(zone, {}, "token"), 1001);
  assert.deepEqual(records, retained);
  records.push(...wildcards);
  requests = [];
  assert.equal(await dns.clearWildcardDnsRecords({ ...zone, syncWildcard: true }, {}, "token"), 0);
  assert.equal(requests.length, 0);

  requests = [];
  const synchronized = await dns.syncZone(zone, ["1.1.1.1"], {}, "token");
  assert.equal(synchronized.deleted, 3);
  assert.equal(synchronized.total, 1);
  assert.equal(synchronized.replacedCname, 0);
  assert.deepEqual(records.map((item) => item.id).sort(), retained.map((item) => item.id).sort());
  assert(!requests.some((request) => request.body?.posts?.some((item) => item.name.startsWith("*."))));

  // Valid subdomains work for all three types, renaming, and deletion.
  records = [];
  for (const [name, type, content] of [["WWW.example.com.", "A", "1.1.1.1"], ["ipv6.example.com", "AAAA", "2606:4700:4700::1111"], ["aaa.example.com", "CNAME", "origin.example.net"]]) {
    const created = await dns.createDnsRecord(zone, { name, type, content }, {}, "token");
    assert(dns.isEditableDnsRecord(zone, created));
    assert.equal(created.proxied, false);
  }
  assert.equal(records.length, 3);
  const renamed = await dns.updateDnsRecord(zone, records[2].id, { name: "api.v2.example.com", content: "2.2.2.2" }, {}, "token");
  assert.equal(renamed.name, "api.v2.example.com");
  assert.equal(renamed.type, "A");
  await dns.deleteDnsRecord(zone, renamed.id, {}, "token");
  assert.equal(records.length, 2);
  for (const name of ["*.example.com", "*.www.example.com", "badexample.com", "www.example.com.evil.net", "other.net", "-bad.example.com", "bad..example.com", `${"a".repeat(64)}.example.com`]) {
    await assert.rejects(dns.createDnsRecord(zone, { name, type: "A", content: "1.1.1.1" }, {}, "token"), (error) => error.status === 400);
  }
  await assert.rejects(dns.createDnsRecord({ ...zone, syncWildcard: true }, { name: "www.example.com", type: "A", content: "1.1.1.1" }, {}, "token"), (error) => error.status === 400);
  records = [];
  await dns.createDnsRecord({ ...zone, syncWildcard: true }, { name: "example.com", type: "A", content: "1.1.1.1" }, {}, "token");
  assert.deepEqual(records.map((item) => item.name).sort(), ["*.example.com", "example.com"]);

  // The browser form uses the same validation and preserves explicit names in
  // bulk editing so an unchanged bulk save cannot delete a hidden subdomain.
  const scripts = [...adminPage().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const core = scripts[0], domain = scripts[1];
  const fields = new Map(["#dnsName", "#dnsContent", "#dnsType", "#saveDns", "#dnsForm", "#dnsStatus"].map((key) => [key, { value: "", blur() {}, addEventListener(_name, callback) { this.submit = callback; } }]));
  const label = {};
  const payloads = [];
  const errors = [];
  const profile = { id: "active", ...zone };
  const context = {
    state: { defaultDomain: zone.domain, activeDomainId: profile.id, domains: [profile] },
    dnsState: { records: [], editingId: null },
    $: (selector) => fields.get(selector),
    document: { querySelector: () => label },
    openDns() {}, updateDnsHint() {}, closeDns() {}, loadDns: async () => {},
    normalizeDnsContent: (value) => value.trim().toLowerCase(),
    api: async (path, input) => payloads.push({ path, ...JSON.parse(input.body) }),
    setStatus() {}, notify: (message, kind) => { if (kind === "error") errors.push(message); },
  };
  runInNewContext(domain.slice(0, domain.indexOf("const domainSyncStyle")) + "\n" + domain.match(/^const originalOpenDns=.*$/m)[0] + "\n" + domain.match(/^\$\('#dnsForm'\).*$/m)[0] + "\n" + core.match(/^function parseBulkDnsText.*$/m)[0] + "\n" + core.match(/^function bulkDnsRecordText.*$/m)[0] + "\n" + core.match(/^function detectDnsType.*$/m)[0] + "\n" + core.match(/^function isDnsIpv4.*$/m)[0] + "\n" + core.match(/^function isDnsIpv6.*$/m)[0], context);
  context.openDns();
  assert.equal(fields.get("#dnsName").readOnly, false);
  assert(label.textContent.includes("子域名"));
  fields.get("#dnsName").value = "aaa.example.com";
  fields.get("#dnsContent").value = "origin.example.net";
  await fields.get("#dnsForm").submit({ preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(payloads.at(-1).name, "aaa.example.com");
  assert.equal(payloads.at(-1).type, "CNAME");
  assert.equal(errors.length, 0);
  profile.syncWildcard = true;
  context.openDns();
  assert.equal(fields.get("#dnsName").readOnly, true);
  fields.get("#dnsName").value = "aaa.example.com";
  await fields.get("#dnsForm").submit({ preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(payloads.length, 1);
  assert.equal(errors.length, 1);
  profile.syncWildcard = false;
  records = [record("example.com", "A", "1.1.1.1", { editable: true }), record("aaa.example.com", "CNAME", "origin.example.net", { editable: true })];
  const bulkText = records.map(context.bulkDnsRecordText).join("\n");
  const parsed = context.parseBulkDnsText(bulkText);
  assert.equal(parsed.errors.length, 0);
  const bulkResult = await dns.replaceDnsRecords(zone, parsed.records, {}, "token");
  assert.equal(bulkResult.deleted, 0);
  assert.equal(records.length, 2);

  // Save-config integration covers enabled -> disabled, already disabled, new
  // disabled profiles, correct per-domain tokens, and failed cleanup/locking.
  let saved;
  const env = {
    ADMIN_PASSWORD: "test-password",
    PDM_KV: {
      get: async (key) => key === "settings" ? saved : null,
      put: async (key, value) => { if (key === "settings") { assert(locked); saved = JSON.parse(value); } },
      delete: async () => {},
    },
    SYNC_LOCK: {
      idFromName: (name) => name,
      get: () => ({ fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/acquire") { if (locked) return new Response("busy", { status: 409 }); locked = true; return new Response("ok"); }
        if (url.pathname === "/release") { locked = false; return new Response("ok"); }
        return Response.json({ cronEnabled: true });
      } }),
    },
  };
  const cookie = `pdm_session=${await createSession(env.ADMIN_PASSWORD)}`;
  const baseSettings = { ipSources: [], manualIps: [], domains: [{ id: "active", ...zone, syncWildcard: true, apiToken: "per-domain-token" }], defaultDomain: zone.domain, cfZoneId: zone.zoneId };
  const save = () => handleApi(new Request("https://worker.example/api/config", { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ domains: [{ id: "active", ...zone, apiToken: "" }] }) }), env);
  for (const initialDomains of [baseSettings.domains, [{ ...baseSettings.domains[0], syncWildcard: false }], []]) {
    saved = { ...baseSettings, domains: initialDomains };
    if (!initialDomains.length) saved = { ...saved, defaultDomain: "", cfZoneId: "" };
    records = [...retained, ...wildcards];
    requests = [];
    // New profiles need a token; existing profiles may leave it blank.
    const request = new Request("https://worker.example/api/config", { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ domains: [{ id: "active", ...zone, apiToken: initialDomains.length ? "" : "per-domain-token" }] }) });
    const response = await handleApi(request, env);
    assert.equal(response.status, 200);
    assert.equal(saved.domains[0].syncWildcard, false);
    assert.equal(records.length, retained.length);
    assert(requests.every((request) => request.locked && request.token === "Bearer per-domain-token"));
    assert.equal(locked, false);
  }
  saved = structuredClone(baseSettings);
  records = [...retained, ...wildcards];
  rejectCleanup = true;
  await assert.rejects(save(), (error) => error.status === 403 && error.message.includes("配置未保存"));
  assert.equal(saved.domains[0].syncWildcard, true);
  assert.equal(locked, false);
  rejectCleanup = false;
  locked = true;
  requests = [];
  await assert.rejects(save(), /已有同步任务/);
  assert.equal(requests.length, 0);
  assert.equal(saved.domains[0].syncWildcard, true);
  console.log("Wildcard cleanup, subdomain CRUD, browser form/bulk editing, and configuration save: ok");
} finally {
  globalThis.fetch = originalFetch;
  rmSync(directory, { recursive: true, force: true });
}
