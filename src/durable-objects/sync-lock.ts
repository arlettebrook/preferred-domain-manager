export class SyncLock {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === "/acquire") {
      let response: Response;
      await this.state.blockConcurrencyWhile(async () => {
        const now = Date.now();
        const current = await this.state.storage.get<number>("expiresAt");
        if (current && current > now) {
          response = new Response("busy", { status: 409 });
          return;
        }
        const body = await request.json<{ ttl?: number }>().catch(() => ({ ttl: undefined }));
        await this.state.storage.put("expiresAt", now + Math.min(Math.max(body.ttl ?? 900000, 30000), 1800000));
        response = new Response("ok");
      });
      return response!;
    }
    if (path === "/release") {
      await this.state.storage.delete("expiresAt");
      return new Response("ok");
    }
    const now = Date.now();
    const current = await this.state.storage.get<number>("expiresAt");
    return new Response(JSON.stringify({ locked: Boolean(current && current > now), expiresAt: current ?? null }), { headers: { "content-type": "application/json" } });
  }
}

