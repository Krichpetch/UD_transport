# UD Transport

Universal Design accessibility assessment system for สนข. (Office of Transport and Traffic
Policy and Planning), Ministry of Transport, Thailand.

Turborepo monorepo — `apps/web` (Next.js), `apps/api` (NestJS + Prisma + PostgreSQL/PostGIS).

## Local development bring-up

The database needs **PostGIS**, not stock Postgres — `GET /stations/nearby` and the checklist
submit proximity gate both run `ST_DWithin`/`ST_Distance` queries, which fail immediately on a
plain `postgres` image (`CREATE EXTENSION postgis` will error: extension not available).

1. **Start the database:**
   ```bash
   docker compose up -d db
   ```
   This brings up `postgis/postgis:16-3.4` (see `docker-compose.yml`) with a named volume, on
   `localhost:5432`, user `postgres` / password `password` / db `ud_transport`.

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Configure `apps/api/.env`** (not committed — create it yourself) with at minimum:
   ```
   DATABASE_URL=postgresql://postgres:password@localhost:5432/ud_transport
   JWT_SECRET=<32+ random characters — never a placeholder in production>
   MINIO_ACCESS_KEY=<your MinIO access key>
   MINIO_SECRET_KEY=<your MinIO secret key>
   MINIO_PUBLIC_ENDPOINT=http://localhost:9000
   FRONTEND_URL=http://localhost:3000
   ```
   `DATABASE_URL` must match the `db` service above. MinIO itself isn't in `docker-compose.yml`
   yet — run it separately (`docker run ... minio/minio`) and point the two `MINIO_*` keys at it.

4. **Apply migrations, then PostGIS** (two separate steps — the PostGIS extension and geography
   index live outside Prisma's schema tracking on purpose, see
   `apps/api/prisma/migrations_manual/`; everything else is a real tracked migration as of
   2026-07-27 — see the callout below):
   ```bash
   pnpm --filter api exec prisma migrate deploy
   pnpm --filter api db:manual-migrations
   ```
   `db:manual-migrations` runs every `.sql` file in `apps/api/prisma/migrations_manual/` — it's
   idempotent, safe to re-run any time (e.g. after pulling a new manual migration file).

   **`prisma db push` is no longer the intended day-to-day workflow.** Until 2026-07-27, several
   real schema changes (the masterlist-cutover columns, two partial unique indexes) were only
   ever applied via `db push` and never captured in a migration file — which meant a fresh
   `prisma migrate reset` silently came back on an *older* schema than `schema.prisma`, breaking
   `reset-stations.ts` and every other script the moment they touched a missing column. All of
   that is now captured as real migrations. If you change `schema.prisma` going forward, run
   `prisma migrate dev --name <description>` (not `db push`) so the change gets its own migration
   file — then verify nothing has silently drifted with:
   ```bash
   pnpm --filter api db:drift-check
   ```
   (compares the live DB against `prisma/migrations/` and exits non-zero on any gap; see that
   script's own header comment for exactly what it does and why it needs a scratch
   `<database>_shadow` database to exist).

5. **Run everything:**
   ```bash
   pnpm dev
   ```
   `apps/web` → http://localhost:3000, `apps/api` → http://localhost:3001. Turbo's `dev` pipeline
   also runs `@repo/types`' own watch-build in parallel — it ships compiled (`dist/`), not raw
   source, so apps/api can `require()` it; if you ever run apps/api alone without `pnpm dev` at
   the root, run `pnpm --filter @repo/types build` once first.

**Verify it worked:** log in, then hit `GET /stations/nearby?lat=13.7563&lng=100.5018&limit=5` —
if PostGIS isn't set up correctly this 500s instead of returning nearby stations.

## Resetting / reseeding your local dev database

Use this whenever your local DB needs to go back to a known-good state — after
`prisma migrate reset`, after a schema change that isn't additive-safe, or just when local data
has gotten into a weird state. **`prisma migrate reset` only recreates the schema — it does
NOT reseed any content.** There is no `prisma.seed` entry configured in `apps/api/package.json`
(and no `prisma.config.ts`), so Prisma has nothing to auto-run after a reset; every step below
must be run by hand, **in this order**, from `apps/api/`:

```bash
npx prisma migrate reset --force              # drops + recreates the DB, applies all migrations
                                               # (irreversible — see the warning below)
npx ts-node prisma/seed.ts                    # 3 baseline accounts: admin / auditor1 / executive
                                               # (password123). No stations — see note below.
npx ts-node prisma/reset-stations.ts --confirm # 823-row station masterlist (stations_master_v2.json)
npx ts-node prisma/seed-templates.ts          # LawReference + v1 ACTIVE / v2 DRAFT ChecklistTemplate rows
npx ts-node prisma/backfill-region.ts         # derives Station.region (coords -> nearest province,
                                               # falling back to province-string match) — the
                                               # masterlist JSON stores region: null by design
pnpm run db:drift-check                        # confirms the result matches migration history
```

**`prisma migrate reset --force` destroys all data in the target database and must never be run
against a production or shared database** — only ever a disposable local dev DB. Double-check
`DATABASE_URL` in `apps/api/.env` points at `localhost` before running it.

Why 4 separate content-seeding scripts instead of one: `seed.ts` only ever seeded users (its
old station-seeding block referenced a pre-cutover unique key and was removed after it started
failing to even compile); `reset-stations.ts` is the sole source of truth for station identity
data and deliberately does not compute derived fields; `seed-templates.ts` and
`backfill-region.ts` are separate one-time/idempotent passes for exactly the two things
`reset-stations.ts` intentionally leaves for later. All four (after `seed.ts`) are idempotent —
safe to re-run individually if you only need to fix one of them.

If you only lost stations/templates/region (not users), you can skip `seed.ts`/`migrate reset`
and just re-run whichever of the later scripts you need — they're all idempotent.

See "Syncing Railway's DB to local dev state" below for the equivalent sequence against a
deployed environment (same four content scripts, different safety considerations since Railway
may hold real inspection data that doesn't exist locally).

## Deploying the API

`apps/api/Dockerfile` builds a standalone production image (multi-stage: deps → build → deploy →
runner). It expects an external, already-PostGIS-capable Postgres via `DATABASE_URL` at runtime —
the image does not run a database itself. All secrets are passed as env vars at `docker run`
time (see the Dockerfile header), never baked into the image.

## Deploying to Railway

Three Railway services: Postgres, MinIO (self-hosted), `apps/api`, `apps/web` — four total.
See `apps/api/.env.example` and `apps/web/.env.example` for the full var list; this section
covers the parts that aren't obvious from the var names alone.

1. **Postgres + PostGIS.** Use the `postgis/postgis:16-3.4` image — same as local
   `docker-compose.yml` — not stock Postgres (`CREATE EXTENSION postgis` fails otherwise). Turn on
   Railway's automatic backups for this service before loading real inspection data; this is
   government inspection data (see root `CLAUDE.md`), not disposable dev fixtures.

2. **MinIO service.**
   - Pin an exact `minio/minio:RELEASE.*` tag — never `:latest`. Upstream MinIO's Docker Hub image
     is archived, so `:latest` won't move, but pinning is still what makes the deploy reproducible
     later.
   - Attach a persistent volume at `/data`. Without it, every redeploy wipes all evidence photos.
   - Start command: `server /data --console-address ":9001"`.
   - Map the **public** Railway domain to port **9000** (the S3 API). Leave the admin console
     (9001) unmapped/private.
   - Root user/password as Railway secrets, not defaults.
   - Set `MINIO_API_CORS_ALLOW_ORIGIN` to the web app's HTTPS origin, so browser-issued presigned
     uploads aren't blocked by CORS.

3. **API MinIO wiring — the presigned-URL fix.** Set on the API service:
   `MINIO_ENDPOINT=<MinIO's public Railway domain>`, `MINIO_PORT=443`, `MINIO_USE_SSL=true`.
   **Why the public domain and not `*.railway.internal`:** presigned URLs are signed against
   whatever host `MinioService` is configured with. If that's the internal hostname, the URL the
   API hands back to a phone is only resolvable from inside Railway's private network — the phone
   gets an unreachable link, not an error, so this fails silently rather than loudly. The internal
   hostname is fine for the API's own reads if you ever add server-side proxying, but not for
   presigned URLs handed to clients.

4. **Bucket init (one-time, after MinIO is up).**
   ```bash
   mc alias set ud-staging https://<minio-public-domain> <root-access-key> <root-secret-key>
   mc mb ud-staging/ud-transport
   ```
   Then create a scoped access key/policy for the API (read/write on just this bucket) instead of
   running the app on root credentials, and set that key pair as the API's `MINIO_ACCESS_KEY` /
   `MINIO_SECRET_KEY`. The first upload 500s if the bucket doesn't exist yet — this step has to
   happen before anyone tries to attach a photo.

5. **Deploy the two apps.**
   - `apps/api`: existing `Dockerfile`, no build args needed. Point `DATABASE_URL` at Postgres'
     internal connection string (lower latency than public), and the `MINIO_*` vars at step 3.
   - `apps/web`: new `Dockerfile`, needs **`NEXT_PUBLIC_API_URL` passed as a Docker build arg**
     (not a runtime env var) set to the API's public HTTPS URL. Next.js inlines `NEXT_PUBLIC_*` at
     build time — set at runtime instead, and the image silently ships pointing at
     `http://localhost:3001` (`apps/web/lib/api.ts`). For a staging environment (see step 7 below),
     also pass `NEXT_PUBLIC_PROXIMITY_BYPASS=true` as a build arg, or the client still attempts
     real GPS acquisition even though the server-side gate is bypassed.
   - Set `FRONTEND_URL` on the API to the web service's final public URL (used for CORS).
   - Both services need HTTPS — required for the mobile geolocation gate to work at all
     (`navigator.geolocation` is unavailable on plain HTTP in modern mobile browsers). Railway
     provisions this automatically on its `*.up.railway.app` domains.

6. **Load the database — run from your laptop against Postgres' PUBLIC connection string**
   (not the internal one, since your laptop isn't on Railway's private network), in order:
   ```bash
   DATABASE_URL=<railway-public-url> pnpm --filter api db:push
   DATABASE_URL=<railway-public-url> pnpm --filter api db:manual-migrations
   DATABASE_URL=<railway-public-url> pnpm --filter api db:seed
   ```
   `db:seed` only creates 3 test accounts (admin/auditor1/executive) and 10 mock stations — real
   station data has no CLI importer. Instead:
   - Log in as the seeded admin on the deployed staging URL, go to Stations → Bulk Import, and
     upload the real OTP station spreadsheet through the browser
     (`POST /stations/batch-otp`, admin-only).
   - Newly imported stations land at `coordStatus: PENDING`, not `OK` — the proximity gate needs
     `OK` rows to have anything to validate against. Bring matched stations to `OK` by running:
     ```bash
     DATABASE_URL=<railway-public-url> node apps/api/prisma/seed-official-coords.cjs
     ```
     This matches imported stations by name/province/mode against the curated reference file
     already in the repo (`apps/api/prisma/seed-data/stations_master_staging.json`) and upgrades
     confident matches to `coordSource: OFFICIAL, coordStatus: OK`. It writes a match report to
     `apps/api/prisma/seed-official-coords-report.json` — check `unmatchedTotal` in that report;
     a large number means most imported stations still won't have real coordinates.

7. **Staging environment config.** Leave `APP_ENV` unset and set `PROXIMITY_BYPASS=true` on the
   API (plus the matching `NEXT_PUBLIC_PROXIMITY_BYPASS=true` web build arg from step 5) — the
   board demo won't be at a physical station. This is a staging-only setting:
   `validate-env.ts` refuses to boot if `PROXIMITY_BYPASS=true` is ever combined with
   `APP_ENV=production`, so the same misconfiguration can't reach the production environment.

## Syncing Railway's DB to local dev state

Use this whenever local dev has moved ahead of the deployed DB (new Station columns, new
ChecklistTemplate rows, a masterlist reseed, a backfill script) and Railway needs to catch up.
**Always re-run the reproducible scripts below — never `pg_dump`/restore over Railway**, except
for the pre-flight safety backup in step 2. Restoring a dump would also clobber any
Railway-only rows (pilot user accounts, real submitted checklists) that don't exist locally.

None of these scripts take a `--env-file` flag; they read `DATABASE_URL` straight from
`process.env`, exactly like the existing `pnpm --filter api db:push` pattern in step 6 above.
The steps below just make sure that variable is always set *explicitly and visibly*, right
before each command, from a file that never leaves your machine.

### 0. One-time setup

Get the Postgres service's **public** connection string from the Railway dashboard (Postgres
service → "Connect" tab → public/proxy URL, *not* the `*.railway.internal` one — your laptop
isn't on Railway's private network). Save it to `apps/api/.env.railway`:

```
DATABASE_URL=postgresql://postgres:<password>@<something>.proxy.rlwy.net:<port>/railway
```

This filename matches the `.env.*` pattern in `apps/api/.gitignore`, so it's never committed.
Never copy this value into `apps/api/.env` — that's the file every local `pnpm dev` / `prisma`
command reads by default, and a Railway URL sitting there is exactly how a casual local command
ends up hitting the pilot database by accident.

### 1. Target confirmation (repeat before every step below)

PowerShell:
```powershell
$env:DATABASE_URL = (Select-String '^DATABASE_URL=' apps\api\.env.railway).Line.Split('=',2)[1]
$u = [uri]$env:DATABASE_URL
Write-Host "TARGET -> host: $($u.Host)   db: $($u.AbsolutePath.TrimStart('/'))"
```

Bash / Git Bash:
```bash
export DATABASE_URL=$(grep '^DATABASE_URL=' apps/api/.env.railway | cut -d= -f2-)
echo "TARGET -> $DATABASE_URL" | sed -E 's#(://[^:]+:)[^@]+@#\1***@#'
```

Read the printed host out loud before running anything below. If it doesn't say your Railway
Postgres host, stop and fix `.env.railway` first.

### 2. Backup first (Docker pg_dump, no local Postgres install needed)

```powershell
$stamp = Get-Date -Format yyyyMMdd-HHmmss
New-Item -ItemType Directory -Force apps\api\backups | Out-Null
docker run --rm postgis/postgis:16-3.4 pg_dump "$env:DATABASE_URL" --no-owner --no-privileges `
  | Out-File -Encoding utf8 "apps\api\backups\railway-pre-sync-$stamp.sql"
```

```bash
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p apps/api/backups
docker run --rm postgis/postgis:16-3.4 pg_dump "$DATABASE_URL" --no-owner --no-privileges \
  > "apps/api/backups/railway-pre-sync-$stamp.sql"
```

`apps/api/backups/` is already gitignored. Verify before proceeding:
```powershell
(Get-Item "apps\api\backups\railway-pre-sync-$stamp.sql").Length   # must be > 0
Select-String -Path "apps\api\backups\railway-pre-sync-$stamp.sql" -Pattern 'CREATE TABLE' | Select-Object -First 3
```
If the file is empty or has no `CREATE TABLE` lines, stop — something's wrong with the
connection string or Docker's outbound network, not with the target DB. Don't proceed to step 3
without a verified-good backup file.

### 3. Quick inventory read (before touching anything)

```bash
docker run --rm postgis/postgis:16-3.4 psql "$DATABASE_URL" -c "
  select 'users' t, count(*) from \"User\"
  union all select 'stations', count(*) from \"Station\"
  union all select 'checklists', count(*) from \"Checklist\";"
docker run --rm postgis/postgis:16-3.4 psql "$DATABASE_URL" -c "
  select mode, \"variantKey\", version, status, count(*) from \"ChecklistTemplate\"
  group by 1,2,3,4 order by 1,2,3;"
```
(If `ChecklistTemplate`/`User` don't exist yet, that's expected on a DB that predates this
schema — it just means step 4 hasn't run yet.)

### 4. Schema sync — `prisma db push`

```bash
cd apps/api
DATABASE_URL="$RAILWAY_URL_FROM_STEP_1" pnpm exec prisma db push
```
Read prisma's output carefully. The Station fields added since the last deploy (`line`,
`stationType`, `coordSource`, `coordStatus`, `region`, `yearBuilt`) are all nullable or have a
Prisma-level `@default`, so this push is expected to be additive-only with **no** destructive
warning. If prisma reports it would drop a column/table or lose data anyway, stop and confirm
with the user before adding `--accept-data-loss` — do not pass that flag reflexively.

Confirm PostGIS is available (required for `/stations/nearby` and the checklist proximity
gate):
```bash
docker run --rm postgis/postgis:16-3.4 psql "$DATABASE_URL" -c "select postgis_version();"
```
If that errors (extension not installed / not supported by the provider's Postgres image),
stop — the Railway Postgres service needs to be on a PostGIS-capable image (`postgis/postgis`,
same as `docker-compose.yml`), not stock Postgres. See the "Deploying to Railway" section above.

Then apply the manual PostGIS migration (geography column + index — lives outside Prisma's
schema tracking on purpose, see `apps/api/prisma/migrations_manual/`):
```bash
DATABASE_URL="$RAILWAY_URL" pnpm --filter api db:manual-migrations
```
This is idempotent — safe to re-run.

Check for new required env vars before moving on: `apps/api/src/config/validate-env.ts`
currently requires `JWT_SECRET`, `DATABASE_URL`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`,
`MINIO_PUBLIC_ENDPOINT`, `FRONTEND_URL` — nothing new was added alongside the Station schema
changes, so no new Railway service variables are needed for this sync specifically. If a future
sync does add a new required env, add it as a Railway service variable *before* redeploying the
API, or the API will refuse to boot (`validateEnv()` throws).

**Redeploy the API now**, before seeding. The Railway API's already-running instance was built
against the old Prisma Client and doesn't know about the new Station columns — the sooner it's
redeployed against the new schema, the shorter the window where the deployed app is mismatched
with its own DB. The seed/reset/backfill scripts below run from your laptop with your local
(already up to date) Prisma Client, so they can run before or after the redeploy; the deployed
API itself just shouldn't sit mismatched any longer than necessary.

### 5. Seed templates

```bash
DATABASE_URL="$RAILWAY_URL" pnpm --filter api exec ts-node prisma/seed-templates.ts
```
Idempotent (upserts by `(mode, variantKey, version)`). Re-run the inventory query from step 3
afterward and confirm template row counts match your local dev DB's counts for the same query.

### 6. Station masterlist reset + reseed

Run **without** `--force` first — this prints the full inventory (station count, checklist
counts by status, AuditLog rows) and refuses to proceed if any `SUBMITTED`/`APPROVED`
checklists exist, since the reset deletes all Station rows and Checklist has no cascade delete
(checklists must be deleted first, in the same transaction):
```bash
DATABASE_URL="$RAILWAY_URL" pnpm --filter api exec ts-node prisma/reset-stations.ts --confirm
```
- If it completes (no protected checklists found): 823 stations seeded, done — skip to step 7.
- If it refuses because protected checklists exist: **stop and report the exact counts to the
  user before doing anything else.** Real pilot inspection data may exist on Railway that
  doesn't exist locally — this is government inspection data (see root `CLAUDE.md`), not
  disposable fixtures. Only re-run with `--force` once the user has explicitly confirmed they
  want those checklists (and their stations) deleted. The script writes its own timestamped
  JSON backup of stations+checklists to `apps/api/backups/` immediately before deleting,
  regardless — but that's a safety net, not a substitute for asking first.

### 7. Region backfill

```bash
DATABASE_URL="$RAILWAY_URL" pnpm --filter api exec ts-node prisma/backfill-region.ts
```
Compare the per-region counts it prints against the local run's output — same input data
(`stations_master_v2.json`) and same `deriveRegion()` algorithm, so the distribution must match
exactly (as of the 2026-07-26 local run: กลาง 371, ตะวันออกเฉียงเหนือ 141, ใต้ 141, เหนือ 88,
ตะวันออก 46, ตะวันตก 34, 2 remain "ไม่ระบุ"). A mismatch means something about the input data or
script differs between environments — investigate before calling the sync done.

### 8. Verify

Side-by-side counts (template rows by mode/variantKey/version, station count, region
distribution) — remote vs. local, from steps 3/5/6/7's output.

Every route in this API is `@UseGuards(JwtAuthGuard)`-protected — there is no public
`/health` or public template route (by design, see root `CLAUDE.md`'s role-guard rule), so an
anonymous curl only proves the process is up (`curl -s <api-url>/anything` returning a NestJS
`{"statusCode":404,...}` JSON body, not a connection error, confirms that much). The only
unguarded route is `POST /auth/login`, so a real scripted check needs real credentials:
```bash
TOKEN=$(curl -s -X POST https://<api-service>.up.railway.app/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<admin-username>","password":"<admin-password>"}' | jq -r .accessToken)
curl -s https://<api-service>.up.railway.app/stations?limit=1 -H "Authorization: Bearer $TOKEN"
```
Simplest and most reliable: log in on the deployed web URL as a real user, load the station
list (region + coordStatus columns should be populated, not blank — this is what the region
backfill in step 7 fixes), and open a checklist preview.

### 9. If you redeploy the API after seeding instead of before

Fine either way per step 4's note — just don't leave it mismatched long. Trigger the redeploy
from the Railway dashboard (or `git push` if the service auto-deploys from a branch) and re-run
the step 8 curl checks against the freshly deployed instance afterward.
