interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  APP_ENV?: string;
}

const INSTALLER_URL = "https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh";

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

    if (url.pathname === "/install" || url.pathname === "/install.sh") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
        });
      }
      try {
        const upstream = await fetch(INSTALLER_URL, {
          method: request.method,
          headers: { Accept: "text/plain" },
        });
        if (!upstream.ok) {
          return new Response("GULZ installer is temporarily unavailable. Try again later.", {
            status: 502,
            headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
          });
        }
        return new Response(request.method === "HEAD" ? null : upstream.body, {
          status: 200,
          headers: {
            "Content-Type": "text/x-shellscript; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
          },
        });
      } catch {
        return new Response("Could not retrieve the GULZ installer. Try again later.", {
          status: 502,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
