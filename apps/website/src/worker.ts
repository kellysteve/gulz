interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  APP_ENV?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

const INSTALLER_URL = "https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh";
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function bearer(request: Request): string {
  const value = request.headers.get("Authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}
function configured(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY);
}
function supabaseHeaders(env: Env): HeadersInit {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY!, "Content-Type": "application/json" };
}
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function randomToken(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function pairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}
async function requestUser(request: Request, env: Env): Promise<{ id: string; login?: string } | null> {
  const token = bearer(request);
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
  });
  if (!response.ok) return null;
  const user = await response.json() as { id?: unknown; user_metadata?: Record<string, unknown> };
  if (typeof user.id !== "string") return null;
  const login = user.user_metadata?.user_name ?? user.user_metadata?.preferred_username;
  return { id: user.id, ...(typeof login === "string" ? { login } : {}) };
}
async function rest(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(env.SUPABASE_URL!.replace(/\/$/, "") + "/rest/v1/" + path, {
    ...init,
    headers: { ...supabaseHeaders(env), ...(init.headers ?? {}) },
  });
}
async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (!configured(env)) return json({ error: "GULZ account services are not configured yet. Set the Supabase Worker secrets and apply the Places migration." }, 503);
  if (request.method !== "POST" && request.method !== "GET" && request.method !== "DELETE") return json({ error: "Method not allowed." }, 405);
  if (url.pathname === "/api/places/pair/start") {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const user = await requestUser(request, env);
    if (!user) return json({ error: "Sign in with GitHub to create a Place pairing code." }, 401);
    const recent = await rest(env, "gulz_place_pairing_codes?select=id&user_id=eq." + encodeURIComponent(user.id) + "&created_at=gte." + encodeURIComponent(new Date(Date.now() - 60_000).toISOString()));
    if (!recent.ok) return json({ error: "Could not check pairing rate limits." }, 502);
    const recentRows = await recent.json() as unknown[];
    if (recentRows.length >= 3) return json({ error: "Please wait before generating another pairing code." }, 429);
    const code = pairingCode();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const inserted = await rest(env, "gulz_place_pairing_codes", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: user.id, code_hash: await digest(code), expires_at: expiresAt }),
    });
    if (!inserted.ok) return json({ error: "Could not create a pairing code." }, 502);
    return json({ code, expiresAt, expiresInSeconds: 600 });
  }
  if (url.pathname === "/api/places/pair/complete") {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON body." }, 400); }
    const code = typeof body.code === "string" ? body.code.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return json({ error: "Enter the eight-character code shown in your GULZ dashboard." }, 400);
    const deviceToken = randomToken(32);
    const tokenHash = await digest(deviceToken);
    const result = await rest(env, "rpc/gulz_complete_place_pairing", {
      method: "POST",
      body: JSON.stringify({
        p_code_hash: await digest(code),
        p_place_name: typeof body.name === "string" ? body.name.slice(0, 80) : "GULZ Place",
        p_platform: typeof body.platform === "string" ? body.platform.slice(0, 40) : "unknown",
        p_architecture: typeof body.architecture === "string" ? body.architecture.slice(0, 40) : "unknown",
        p_gulz_version: typeof body.version === "string" ? body.version.slice(0, 40) : "unknown",
        p_device_token_hash: tokenHash,
      }),
    });
    if (!result.ok) return json({ error: "That pairing code is invalid, expired or already used. Generate a new code on the website." }, 400);
    const place = await result.json() as { id?: string };
    return json({ placeId: place.id, deviceToken, message: "This GULZ Place is now connected to your account." });
  }
  if (url.pathname === "/api/places/heartbeat") {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const token = bearer(request);
    if (!token) return json({ error: "Place credential required." }, 401);
    const tokenHash = await digest(token);
    let body: Record<string, unknown> = {};
    try { body = await request.json() as Record<string, unknown>; } catch { /* optional heartbeat metadata */ }
    const query = "gulz_places?select=id&device_token_hash=eq." + tokenHash + "&revoked_at=is.null&limit=1";
    const found = await rest(env, query);
    if (!found.ok) return json({ error: "Could not verify this Place." }, 502);
    const rows = await found.json() as Array<{ id: string }>;
    if (!rows[0]) return json({ error: "This Place has been disconnected. Pair it again from your dashboard." }, 401);
    const updated = await rest(env, "gulz_places?id=eq." + rows[0].id, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        last_seen_at: new Date().toISOString(), status: "online",
        ...(typeof body.name === "string" ? { place_name: body.name.slice(0, 80) } : {}),
        ...(typeof body.version === "string" ? { gulz_version: body.version.slice(0, 40) } : {}),
        ...(typeof body.provider === "string" ? { active_provider: body.provider.slice(0, 80) } : {}),
        ...(typeof body.model === "string" ? { active_model: body.model.slice(0, 120) } : {}),
        ...(typeof body.providerStatus === "string" && ["configured", "connected", "error", "unknown"].includes(body.providerStatus) ? { provider_status: body.providerStatus } : {}),
      }),
    });
    if (!updated.ok) return json({ error: "Could not update Place status." }, 502);
    return json({ ok: true });
  }
  if (url.pathname === "/api/places") {
    const user = await requestUser(request, env);
    if (!user) return json({ error: "Sign in with GitHub to view your Places." }, 401);
    const response = await rest(env, "gulz_places?select=id,place_name,platform,architecture,gulz_version,active_provider,active_model,status,created_at,last_seen_at&user_id=eq." + encodeURIComponent(user.id) + "&revoked_at=is.null&order=last_seen_at.desc");
    if (!response.ok) return json({ error: "Could not load your Places." }, 502);
    const rows = await response.json() as Array<Record<string, unknown>>;
    const places = rows.map((place) => ({
      ...place,
      status: typeof place.last_seen_at === "string" && Date.now() - Date.parse(place.last_seen_at) > 5 * 60_000 ? "offline" : "online",
    }));
    return json({ places });
  }
  if (url.pathname === "/api/places/revoke") {
    const user = await requestUser(request, env);
    if (!user) return json({ error: "Sign in to manage your Places." }, 401);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON body." }, 400); }
    if (typeof body.id !== "string") return json({ error: "Place ID is required." }, 400);
    const response = await rest(env, "gulz_places?id=eq." + encodeURIComponent(body.id) + "&user_id=eq." + encodeURIComponent(user.id) + "&revoked_at=is.null", {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ revoked_at: new Date().toISOString(), status: "revoked" }),
    });
    if (!response.ok) return json({ error: "Could not disconnect this Place." }, 502);
    return json({ ok: true });
  }
  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/places/")) return handleApi(request, env, url);
    if (url.pathname === "/api/places") return handleApi(request, env, url);

    if (url.pathname === "/api/health") {
      return json({
        name: "GULZ",
        status: "early-development",
        environment: env.APP_ENV ?? "unknown",
        accountServicesConfigured: configured(env),
      });
    }

    if (url.pathname === "/install" || url.pathname === "/install.sh") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
      }
      try {
        const upstream = await fetch(INSTALLER_URL, { method: request.method, headers: { Accept: "text/plain" } });
        if (!upstream.ok) return new Response("GULZ installer is temporarily unavailable. Try again later.", {
          status: 502, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
        return new Response(request.method === "HEAD" ? null : upstream.body, {
          status: 200,
          headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" },
        });
      } catch {
        return new Response("Could not retrieve the GULZ installer. Try again later.", {
          status: 502, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
