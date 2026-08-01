import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "../config";
import { Env } from "../types";

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

export async function createSession(secret: string) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expires);
  return `${payload}.${bytesToBase64Url(await hmac(payload, secret))}`;
}

export async function verifyPassword(value: string, expected: string) {
  const [actual, target] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
  ]);
  const actualBytes = new Uint8Array(actual);
  const targetBytes = new Uint8Array(target);
  let mismatch = 0;
  for (let index = 0; index < targetBytes.length; index++) mismatch |= actualBytes[index] ^ targetBytes[index];
  return mismatch === 0;
}

export async function isValidSession(request: Request, env: Env) {
  const secret = env.SESSION_SECRET || env.ADMIN_PASSWORD;
  if (!secret) return false;
  const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return false;
  const [, expires, signature] = cookie.match(new RegExp(`^${SESSION_COOKIE}=([^.]+)\\.(.+)$`)) ?? [];
  if (!expires || !signature || Number(expires) < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(expires, secret);
  let actual: Uint8Array;
  try {
    actual = base64UrlToBytes(signature);
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < actual.length; index++) mismatch |= actual[index] ^ expected[index];
  return mismatch === 0;
}

export function sessionCookie(value: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

export function expiredCookie(request?: Request) {
  const secure = request && new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure}`;
}
