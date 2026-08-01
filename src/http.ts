import { HttpError } from "./errors";

const securityHeaders = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
};

export function json(data: unknown, status = 200, init: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...securityHeaders, "content-type": "application/json; charset=utf-8", ...init },
  });
}

export function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      ...securityHeaders,
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json<T>();
  } catch {
    throw new HttpError(400, "请求体必须是 JSON");
  }
}
