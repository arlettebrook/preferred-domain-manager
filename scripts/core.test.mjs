import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadTypeScript(relativePath, stubs = {}) {
  const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: (request) => stubs[request] ?? {},
    crypto: globalThis.crypto,
    TextEncoder,
    Uint8Array,
    Request,
    btoa,
    atob,
    Date,
    Math,
    Promise,
    String,
    RegExp,
  };
  vm.runInNewContext(output, context, { filename: relativePath });
  return module.exports;
}

const validation = loadTypeScript("src/validation.ts");
const session = loadTypeScript("src/security/session.ts", {
  "../config": { SESSION_COOKIE: "pdm_session", SESSION_TTL_SECONDS: 3600 },
});

test("domain and admin path normalization stays safe", () => {
  assert.equal(validation.normalizeDomain(" HTTPS://Example.COM/path "), "example.com");
  assert.equal(validation.normalizeDomain("*.Sub.Example.com"), "sub.example.com");
  assert.equal(validation.normalizeAdminPath("manage/"), "/manage");
  assert.equal(validation.isValidAdminPath("/manage/settings"), true);
  assert.equal(validation.isValidAdminPath("/api"), false);
  assert.equal(validation.isValidAdminPath("/telegram/webhook"), false);
});

test("IP parsing and DNS type detection handle common boundaries", () => {
  assert.equal(validation.isIPv4("1.1.1.1"), true);
  assert.equal(validation.isIPv4("255.255.255.255"), true);
  assert.equal(validation.isIPv4("256.1.1.1"), false);
  assert.equal(validation.isIPv6("2001:db8::1"), true);
  assert.equal(validation.isIPv6("2001:db8:0:0:0:0:0:1"), true);
  assert.equal(validation.detectDnsRecordType("2606:4700:4700::1111"), "AAAA");
  assert.equal(validation.detectDnsRecordType("1.1.1.1"), "A");
  assert.equal(validation.detectDnsRecordType("target.example.com"), "CNAME");
  assert.deepEqual(Array.from(validation.dedupeIps(["1.1.1.1", " 1.1.1.1 ", "invalid", "::1"])), ["1.1.1.1", "::1"]);
});

test("HTML escaping protects dynamic UI values", () => {
  assert.equal(validation.escapeHtml(`<script>alert("x")</script>`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
});

test("session signatures and password verification work without plaintext comparison", async () => {
  assert.equal(await session.verifyPassword("correct horse", "correct horse"), true);
  assert.equal(await session.verifyPassword("wrong horse", "correct horse"), false);
  const token = await session.createSession("session-secret");
  assert.match(token, /^\d+\.[A-Za-z0-9_-]+$/);
  const request = new Request("https://example.com/admin", { headers: { cookie: `pdm_session=${token}` } });
  assert.equal(await session.isValidSession(request, { SESSION_SECRET: "session-secret" }), true);
  assert.equal(await session.isValidSession(request, { SESSION_SECRET: "wrong-secret" }), false);
});
