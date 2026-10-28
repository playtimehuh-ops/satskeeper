# SatsKeeper

Android app that embeds a bandwidth-sharing SDK. The SDK pays the publisher per opted-in active device. A configurable share of that revenue becomes user points; the rest is profit. Users redeem points for gift cards once they reach a threshold.

- Backend: Vercel serverless functions in `/api` (Node 22, CommonJS)
- Database: Supabase Postgres (`supabase/schema.sql`)
- Admin dashboard: static files in `/public`
- Client: Android app in `/android` (Kotlin, minSdk 26, XML views)

Everything runs on free tiers.

## 1. Supabase setup

1. Create a project at supabase.com.
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it once.
3. Open **Project Settings → API** and copy the **Project URL** and the **service_role** key.
   The service_role key is secret. It is used only by the Vercel API; never put it in the Android app.

All tables have row level security enabled with no policies, so only the service_role key can read or write them.

## 2. Vercel setup

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project**, import the repo. Framework preset: **Other**. No build command.
3. Add the environment variables below (Production and Preview), then deploy.

| Variable | Required | Description |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase service_role key |
| `APP_KEY` | yes | Shared secret sent by the Android app in `x-app-key` (`openssl rand -hex 24`) |
| `ADMIN_USER` | yes | Dashboard / admin API username |
| `ADMIN_PASS` | yes | Dashboard / admin API password (use a long one) |
| `PAYOUT_PCT` | no | Share of revenue paid out as points, default `0.5` |
| `POINTS_PER_CENT` | no | Points per cent of user-share revenue, default `1` |
| `POINTS_PER_DOLLAR` | no | Points that equal one dollar of gift card, default `100` |
| `THRESHOLD_POINTS` | no | Points needed to redeem, default `1000` |
| `GIFT_CARD_PROVIDER` | no | `manual` (default). Others throw "not implemented" |

Values in the Supabase `config` table (`payout_pct`, `points_per_cent`, `points_per_dollar`, `threshold_points`) override the environment variables. Change them in the Table Editor; the API picks them up within about 10 seconds.

Open `https://YOUR-APP.vercel.app/` and sign in with `ADMIN_USER` / `ADMIN_PASS` (browser Basic-auth prompt).

Local development: `npm install`, copy `.env.example` to `.env`, then `npm run dev`.

## 3. Android setup

Copy `android/gradle.properties.example` to `android/gradle.properties` (git-ignored) and fill in:

```
API_BASE_URL=https://YOUR-APP.vercel.app
APP_KEY=the same value as the APP_KEY Vercel variable
```

Open `/android` in Android Studio (AGP 8.5, Gradle 8.7) and run. The `APP_KEY` ships inside the APK, so treat it as a weak client identifier, not a strong secret. Rotate it in Vercel if it leaks.

### Building the APK on GitHub

`.github/workflows/android.yml` builds a debug APK on every push to `main` that touches `android/`, or on demand from the **Actions** tab. Add two repository secrets first (**Settings → Secrets and variables → Actions**): `API_BASE_URL` and `APP_KEY`. Then download `satskeeper-debug-apk` from the finished run. This is a debug build for testing; a release build needs a signing keystore.

## 4. Swapping the SDK adapter

All SDK access goes through the `BandwidthProvider` interface (`init`, `start`, `stop`, `isOptedIn`, `getDeviceId`).

1. Write a new class implementing `BandwidthProvider` (copy `ProxiesSxProvider.kt`).
2. In `MainActivity.kt`, change the single line in `createProvider()`:

```kotlin
private fun createProvider(): BandwidthProvider = ProxiesSxProvider(applicationContext)
```

Nothing else changes. `ProxiesSxProvider` has stubbed network calls marked `// TODO: real SDK` where vendor calls go.

## 5. The manual payout loop

Redemptions are never issued automatically.

1. A user reaches the threshold and taps **Redeem**. A `pending` redemption is created and the points are deducted atomically.
2. Each cycle, re-read the SDK partner's current terms (see the warning below).
3. In the dashboard **Redemptions** tab, press **Approve** to see the buy-by-hand instructions, or **Reject** to refund the points.
4. Buy the gift card yourself (for example on the Bitrefill website; its anonymous tier is web-only and has no public account-free API).
5. Paste the code into the row and press **Mark paid**. The code is stored with the redemption and the card value counts toward "gift cards paid".
6. Record SDK revenue per device each period via `POST /api/admin/credit` (below) so points reach users.

Crediting revenue (Basic auth):

```
curl -u admin:PASSWORD -X POST https://YOUR-APP.vercel.app/api/admin/credit \
  -H "content-type: application/json" \
  -d '{"device_id":"<uuid>","period":"2026-10","revenue_cents":120}'
```

Each `(device_id, period)` can be credited only once.

## 6. Economics

```
points_awarded = revenue_cents × payout_pct × streak_multiplier × points_per_cent     (user share capped at 100% of revenue)
card_value     = points / points_per_dollar        (default 100 points = $1.00)
profit         = revenue in − gift cards paid
```

Streak multiplier: 1.0 below 7 active days, 1.25 at 7+, 1.5 at 30+.

Defaults: `payout_pct=0.5`, `points_per_cent=1`, `points_per_dollar=100`. At those values 1 cent of revenue becomes 0.5 points, so $1.00 of revenue earns 50 points, and 1000 points (the threshold, worth $10.00 of cards) needs $20.00 of revenue. Keep `points_per_cent` and `points_per_dollar` consistent (1 and 100 means 1 point = 1 cent of card value); if they drift apart, the cards you give out stop matching the revenue you took in. The dashboard shows a red warning whenever gift cards paid exceed revenue in.

Rules enforced by the code:

- Consent is explicit and revocable. Opting out clears `consent_at`, and the app stops the SDK immediately.
- 7 days idle resets streak, multiplier and leaderboard rank only. `points_balance` and `lifetime_points` are never reset.
- Redemptions start as `pending`. A human approves.
- `spend_points` is a single guarded `UPDATE`, so a user cannot double-redeem.

## Warning: provider policy

No bandwidth-sharing SDK guarantees it will stay no-KYC, keep its payout terms, or allow your use case forever. Re-check the provider's current terms, payout requirements and any identity or tax obligations **before every payout cycle**, and do not promise users a fixed value. Users must also be told clearly what is shared and be able to stop at any time; the app is built around that.
