# SatsKeeper

SatsKeeper is an Android rewards app with a Vercel serverless API, Supabase Postgres database, and static admin dashboard.

> **Important:** the Android UI and consent flow are implemented, but `ProxiesSxProvider` is currently a stub. It does not actually share bandwidth or generate partner revenue until a real, authorized SDK is integrated. Do not advertise earnings or promise payouts based on the stub.

## Repository layout

- `android/` — Android Studio / Gradle project
- `api/` — Vercel API routes and shared helpers
- `public/` — admin dashboard
- `supabase/schema.sql` — database schema and functions
- `.github/workflows/android.yml` — CI build for a debug APK

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL Editor.
3. Configure the Vercel environment variables below. Keep the service-role key server-side only.

## Vercel environment variables

Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_KEY`, `ADMIN_USER`, and `ADMIN_PASS`.

Optional: `PAYOUT_PCT` (default `0.5`), `POINTS_PER_CENT` (default `1`), `POINTS_PER_DOLLAR` (default `100`), `THRESHOLD_POINTS` (default `1000`), and `GIFT_CARD_PROVIDER` (default `manual`).

Import the repository into Vercel with the **Other** framework preset. Set the variables for each environment you intend to deploy. The admin dashboard is served from `public/`; admin API endpoints use HTTP Basic authentication.

For local development, use Node.js 22, run `npm install`, copy `.env.example` to `.env`, fill in the values, and run `npm run dev` (with the Vercel CLI installed).

## Android project and APK

Open the `android/` directory in Android Studio, or build through GitHub Actions.

The workflow builds `android/app/` with Java 17 and Gradle 8.7. Add these repository Actions secrets before starting a build:

- `API_BASE_URL` — full HTTPS URL of the deployed Vercel app, without a trailing slash
- `APP_KEY` — same value as the Vercel `APP_KEY`

Run **Actions → Android APK → Run workflow**. When it completes, open the run and download the `satskeeper-debug-apk` artifact. Debug APKs are for testing; publishing requires a properly signed release build.

## Consent and provider integration

Consent is explicit and revocable. The current `ProxiesSxProvider` contains placeholder calls only. Integrate a real provider SDK according to its current terms and documentation before enabling any bandwidth-sharing claims. Verify consent, opt-out, device behavior, and provider policy before releasing.

## Rewards and payouts

Redemptions are manual: users request redemption, an administrator reviews it, and any gift card is purchased and marked paid by a human. Never promise a fixed redemption value unless actual partner revenue and the program's terms support it. Review relevant provider terms and legal/tax obligations before any payout cycle.
