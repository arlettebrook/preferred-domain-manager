import { HttpError } from "../../errors";
import { DnsTarget, Env } from "../../types";

/** Minimal Cloudflare API client shared by DNS operations. */
export async function cloudflareFetch<T>(
  zone: DnsTarget,
  path: string,
  init: RequestInit,
  _env: Env,
  apiToken?: string,
): Promise<T> {
  if (!apiToken) throw new HttpError(400, "没有配置 Cloudflare API Token");

  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json<{ success: boolean; result: T; errors?: Array<{ message?: string }> }>();
  if (!response.ok || !body.success) {
    throw new HttpError(
      response.status || 502,
      body.errors?.map((error) => error.message).filter(Boolean).join("; ") || "Cloudflare API 请求失败",
    );
  }
  return body.result;
}
