interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  APP_ENV?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        name: "GULZ",
        status: "early-development",
        environment: env.APP_ENV ?? "unknown",
      }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
