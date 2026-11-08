# GULZ accounts and Places

This document describes the optional GitHub-backed account and installation pairing flow.

## User experience

1. Open `https://gulz.gaxity.com.ng/dashboard`.
2. Select **Continue with GitHub**. The website uses Supabase Auth's GitHub OAuth provider; no separate GULZ password is required.
3. Select **Connect a Place** to create an eight-character, single-use pairing code. It expires after ten minutes.
4. During installation, enter the code when prompted, or run `gulz account connect <code>`.
5. The installation exchanges the code for a random per-Place credential. Only its SHA-256 hash is stored in Supabase. The raw credential is stored locally in `~/.gulz/place.json` with owner-only permissions.
6. The dashboard lists Places and shows their platform, architecture, GULZ version, reported provider/model and last heartbeat. A Place is considered offline after five minutes without a heartbeat.
7. A user can revoke a Place from the dashboard. The next heartbeat is rejected. The local user can also remove their credential with `gulz account disconnect`.

GitHub identity is separate from GitHub repository access. The account flow does not request repository permissions. Local coding, BYOK providers, local models and SSH use remain available without signing in.

## Supabase setup

1. Create or select the Supabase project for GULZ.
2. In **Authentication → Providers → GitHub**, enable GitHub and configure the GitHub OAuth App using the callback URL displayed by Supabase.
3. Set the Supabase Site URL to `https://gulz.gaxity.com.ng` and add `https://gulz.gaxity.com.ng/dashboard` to allowed redirect URLs.
4. Apply both `supabase/migrations/20261108000000_places_pairing.sql` and `supabase/migrations/20261108010000_gulz_ai_usage.sql` to the project. The tables have RLS enabled and no browser policies; the Worker uses the service-role key.
5. Configure website build variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Configure Cloudflare Worker secrets (never add the service-role key to Vite build variables):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GULZ_AI_API_KEY` (the upstream hosted-model key; never expose it to the browser or CLI)
   - Optional `GULZ_AI_BASE_URL` (full HTTPS chat-completions URL)
   - Optional `GULZ_AI_MODEL` (default `openai/gpt-4o-mini`)
   - Optional `GULZ_AI_ACCOUNT_DAILY_LIMIT` (default 20)
   - Optional `GULZ_AI_GUEST_DAILY_LIMIT` (default 5)

Example secret setup from the repository root:

```sh
npx wrangler secret put SUPABASE_URL --config apps/website/wrangler.toml
npx wrangler secret put SUPABASE_ANON_KEY --config apps/website/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config apps/website/wrangler.toml
```

The GitHub OAuth client secret belongs in Supabase Auth provider configuration, not in the browser or public repository. The hosted model key belongs only in the Cloudflare Worker secret `GULZ_AI_API_KEY`.

## API

- `POST /api/places/pair/start` — requires a Supabase access token; creates a short-lived code. Rate limited to three code creations per user per minute.
- `POST /api/places/pair/complete` — accepts the one-time code and Place metadata; returns the raw device token once.
- `GET /api/places` — requires a Supabase access token; lists only the signed-in user's active Places.
- `POST /api/places/heartbeat` — requires a Place token; updates last-seen and non-secret provider/model metadata.
- `POST /api/places/revoke` — requires a Supabase access token; revokes one Place owned by that user.
- `POST /api/ai/v1/chat/completions` — OpenAI-compatible hosted GULZ AI proxy. Guest requests are limited by hashed Cloudflare client IP; paired Places are metered against their account.
- `GET /api/ai/usage` — requires a Supabase access token; returns the signed-in account daily request allowance.

All account and Place API responses are marked `Cache-Control: no-store`. Pairing codes and device tokens are hashed before storage. The Worker must be deployed only with the service-role secret configured.

## Hosted GULZ AI quotas

The Worker proxies requests to the configured upstream model without exposing its API key. The default limits are 20 requests per account per UTC day and 5 requests per guest client IP per UTC day. Account usage is shared across all Places connected to that account. The quota function increments requests atomically in Supabase. Failed upstream requests currently consume a request allowance; usage counts requests, not tokens or monetary spend. These are source defaults and must be load-tested and adjusted before public launch.

The CLI can select **GULZ AI (hosted)** from `/provider`. When the Place is paired, the CLI automatically uses its per-Place credential for account metering; otherwise it uses the guest allowance. No upstream provider key is stored on the user's machine.

## Local provider settings

Provider API keys are not sent to the Places API. They remain on the machine that uses them. The current CLI stores provider profiles in `~/.gulz/provider-profiles.json` with owner-only filesystem permissions. This is not encrypted-at-rest storage; protect the OS account and home directory. OS-backed credential vault integration is still required for stronger protection.

## Current implementation boundaries

- The website uses Supabase Auth's GitHub provider; the GitHub OAuth provider must be enabled in the Supabase dashboard.
- The pairing API requires the migration and all three Worker secrets above. Without them it returns a clear 503 rather than pretending to connect.
- Place heartbeat currently occurs when the CLI starts a chat session; it is not a persistent background daemon.
- The dashboard displays connection metadata only. It does not expose provider API keys, browse local files, or remotely control a Place.
- The GULZ-hosted AI gateway, usage metering, account quotas and hosted provider credentials are separate future service work. GitHub sign-in does not imply those services are already live.
