interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  APP_ENV?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GULZ_AI_API_KEY?: string;
  GULZ_AI_BASE_URL?: string;
  GULZ_AI_MODEL?: string;
  GULZ_AI_ACCOUNT_DAILY_LIMIT?: string;
  GULZ_AI_GUEST_DAILY_LIMIT?: string;
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

function dailyLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 10000 ? parsed : fallback;
}
async function aiUsageIdentity(request: Request, env: Env): Promise<{ hash: string; limit: number }> {
  const token = bearer(request);
  if (token) {
    const tokenHash = await digest(token);
    const found = await rest(env, "gulz_places?select=user_id&device_token_hash=eq." + tokenHash + "&revoked_at=is.null&limit=1");
    if (found.ok) {
      const rows = await found.json() as Array<{ user_id: string }>;
      if (rows[0]?.user_id) return {
        hash: await digest(env.SUPABASE_SERVICE_ROLE_KEY + ":user:" + rows[0].user_id),
        limit: dailyLimit(env.GULZ_AI_ACCOUNT_DAILY_LIMIT, 20),
      };
    }
  }
  const address = request.headers.get("CF-Connecting-IP") || "unknown-client";
  return {
    hash: await digest(env.SUPABASE_SERVICE_ROLE_KEY + ":guest:" + address),
    limit: dailyLimit(env.GULZ_AI_GUEST_DAILY_LIMIT, 5),
  };
}
async function aiProxy(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return json({ error: "GULZ AI account and quota services are not configured." }, 503);
  if (!env.GULZ_AI_API_KEY) return json({ error: "The hosted GULZ AI service is not configured yet." }, 503);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > 256_000) return json({ error: "Request body exceeds the 256 KB limit." }, 413);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return json({ error: "Invalid JSON body." }, 400); }
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 40) return json({ error: "Provide between 1 and 40 conversation messages." }, 400);
  const messageBytes = JSON.stringify(body.messages).length;
  if (messageBytes > 180_000) return json({ error: "Conversation content exceeds the 180 KB limit." }, 413);
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length > 40)) return json({ error: "The agent tool catalogue is invalid." }, 400);
  const identity = await aiUsageIdentity(request, env);
  const quota = await rest(env, "rpc/gulz_consume_ai_request", {
    method: "POST",
    body: JSON.stringify({ p_identity_hash: identity.hash, p_daily_limit: identity.limit }),
  });
  if (!quota.ok) return json({ error: "GULZ AI could not check your daily usage allowance." }, 502);
  const allowance = await quota.json() as { allowed?: boolean; used?: number; limit?: number; remaining?: number };
  if (!allowance.allowed) return json({
    error: "Your daily GULZ AI allowance has been used. You can connect your own AI provider with /provider.",
    usage: allowance,
  }, 429);
  const upstreamUrl = env.GULZ_AI_BASE_URL || "https://openrouter.ai/api/v1/chat/completions";
  let parsed: URL;
  try { parsed = new URL(upstreamUrl); } catch { return json({ error: "The hosted AI endpoint is invalid." }, 500); }
  if (parsed.protocol !== "https:") return json({ error: "The hosted AI endpoint must use HTTPS." }, 500);
  try {
    const upstream = await fetch(parsed, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.GULZ_AI_API_KEY,
        "Content-Type": "application/json",
        Accept: body.stream === true ? "text/event-stream, application/json" : "application/json",
        "HTTP-Referer": "https://gulz.gaxity.com.ng",
        "X-Title": "GULZ",
      },
      body: JSON.stringify({ ...body, model: env.GULZ_AI_MODEL || "openai/gpt-4o-mini" }),
    });
    if (!upstream.ok) return json({ error: "The hosted GULZ AI provider could not complete this request. Your request allowance was used; please try again later." }, upstream.status >= 500 ? 502 : upstream.status);
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-GULZ-Usage-Limit": String(allowance.limit ?? identity.limit),
      "X-GULZ-Usage-Remaining": String(allowance.remaining ?? 0),
    });
    const contentType = upstream.headers.get("Content-Type") || "application/json";
    headers.set("Content-Type", contentType);
    if (contentType.includes("text/event-stream")) headers.set("X-Accel-Buffering", "no");
    return new Response(upstream.body, { status: 200, headers });
  } catch {
    return json({ error: "The hosted GULZ AI provider is temporarily unavailable." }, 502);
  }
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (!configured(env)) return json({ error: "GULZ account services are not configured yet. Set the Supabase Worker secrets and apply the Places migration." }, 503);
  if (request.method !== "POST" && request.method !== "GET" && request.method !== "DELETE") return json({ error: "Method not allowed." }, 405);
  if (url.pathname === "/api/ai/usage") {
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
    const user = await requestUser(request, env);
    if (!user) return json({ error: "Sign in to view account-based GULZ AI usage." }, 401);
    const identityHash = await digest(env.SUPABASE_SERVICE_ROLE_KEY + ":user:" + user.id);
    const date = new Date().toISOString().slice(0, 10);
    const response = await rest(env, "gulz_ai_usage_daily?select=requests&identity_hash=eq." + identityHash + "&usage_date=eq." + date + "&limit=1");
    if (!response.ok) return json({ error: "Could not load GULZ AI usage." }, 502);
    const rows = await response.json() as Array<{ requests: number }>;
    const limit = dailyLimit(env.GULZ_AI_ACCOUNT_DAILY_LIMIT, 20);
    const used = rows[0]?.requests ?? 0;
    return json({ used, limit, remaining: Math.max(0, limit - used), resetsAt: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString().slice(0, 10) });
  }
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
    const response = await rest(env, "gulz_places?select=id,place_name,platform,architecture,gulz_version,active_provider,active_model,provider_status,status,created_at,last_seen_at&user_id=eq." + encodeURIComponent(user.id) + "&revoked_at=is.null&order=last_seen_at.desc");
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

    if (url.pathname === "/api/ai/v1/chat/completions") return aiProxy(request, env);
    if (url.pathname === "/api/ai/usage") return handleApi(request, env, url);
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
