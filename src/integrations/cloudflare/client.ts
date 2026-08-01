import { HttpError } from "../../errors";
import { DnsTarget, Env } from "../../types";

const CLOUDFLARE_TIMEOUT_MS = 15_000;

/** Minimal Cloudflare API client shared by DNS operations. */
export async function cloudflareFetch<T>(
  zone: DnsTarget,
  path: string,
  init: RequestInit,
  _env: Env,
  apiToken?: string,
): Promise<T> {
  if (!apiToken) throw new HttpError(400, "未配置 Cloudflare API Token");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLOUDFLARE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if (controller.signal.aborted) throw new HttpError(504, "Cloudflare API 请求超时");
    throw new HttpError(502, error instanceof Error ? error.message : "Cloudflare API 请求失败");
  } finally {
    clearTimeout(timeout);
  }

  let body: { success: boolean; result: T; errors?: Array<{ message?: string }> };
  try {
    body = await response.json<{ success: boolean; result: T; errors?: Array<{ message?: string }> }>();
  } catch {
    throw new HttpError(response.status || 502, "Cloudflare API 返回了无效响应");
  }

  if (!response.ok || !body.success) {
    const retryAfter = response.headers.get("retry-after");
    throw new HttpError(
      response.status || 502,
      body.errors?.map((error) => error.message).filter(Boolean).join("; ") || "Cloudflare API 请求失败",
      retryAfter ? { "retry-after": retryAfter } : {},
    );
  }
  return body.result;
}
