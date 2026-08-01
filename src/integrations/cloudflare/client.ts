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

  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const raw = await response.text();
    let body: { success?: boolean; result?: T; errors?: Array<{ message?: string }> };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") throw new Error("response is not an object");
      body = parsed as typeof body;
    } catch {
      throw new HttpError(response.status || 502, `Cloudflare API 返回了无效响应（HTTP ${response.status}）`);
    }
    if (!response.ok || !body.success) {
      throw new HttpError(
        response.status || 502,
        body.errors?.map((error) => error.message).filter(Boolean).join("; ") || `Cloudflare API 请求失败（HTTP ${response.status}）`,
      );
    }
    return body.result as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, `Cloudflare API 网络请求失败：${error instanceof Error ? error.message : "未知错误"}`);
  }
}
