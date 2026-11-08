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
4. Apply `supabase/migrations/20261108000000_places_pairing.sql` to the project. The tables have RLS enabled and no browser policies; the Worker uses the service-role key.
5. Configure website build variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Configure Cloudflare Worker secrets (never add the service-role key to Vite build variables):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

Example secret setup from the repository root:

```sh
npx wrangler secret put SUPABASE_URL --config apps/website/wrangler.toml
npx wrangler secret put SUPABASE_ANON_KEY --config apps/website/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config apps/website/wrangler.toml
```

The GitHub OAuth client secret belongs in Supabase Auth provider configuration, not in the browser or public repository.

## API

- `POST /api/places/pair/start` — requires a Supabase access token; creates a short-lived code. Rate limited to three code creations per user per minute.
- `POST /api/places/pair/complete` — accepts the one-time code and Place metadata; returns the raw device token once.
- `GET /api/places` — requires a Supabase access token; lists only the signed-in user's active Places.
- `POST /api/places/heartbeat` — requires a Place token; updates last-seen and non-secret provider/model metadata.
- `POST /api/places/revoke` — requires a Supabase access token; revokes one Place owned by that user.

All account and Place API responses are marked `Cache-Control: no-store`. Pairing codes and device tokens are hashed before storage. The Worker must be deployed only with the service-role secret configured.

## Local provider settings

Provider API keys are not sent to the Places API. They remain on the machine that uses them. The current CLI stores provider profiles in `~/.gulz/provider-profiles.json` with owner-only filesystem permissions. This is not encrypted-at-rest storage; protect the OS account and home directory. OS-backed credential vault integration is still required for stronger protection.

## Current implementation boundaries

- The website uses Supabase Auth's GitHub provider; the GitHub OAuth provider must be enabled in the Supabase dashboard.
- The pairing API requires the migration and all three Worker secrets above. Without them it returns a clear 503 rather than pretending to connect.
- Place heartbeat currently occurs when the CLI starts a chat session; it is not a persistent background daemon.
- The dashboard displays connection metadata only. It does not expose provider API keys, browse local files, or remotely control a Place.
- The GULZ-hosted AI gateway, usage metering, account quotas and hosted provider credentials are separate future service work. GitHub sign-in does not imply those services are already live.
