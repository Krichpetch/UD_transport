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

4. **Sync the schema, then apply PostGIS** (two separate steps — this project uses
   `prisma db push`, not `prisma migrate`; the PostGIS extension and geography index live outside
   Prisma's schema tracking on purpose, see `apps/api/prisma/migrations_manual/`):
   ```bash
   pnpm --filter api db:push
   pnpm --filter api db:manual-migrations
   ```
   `db:manual-migrations` runs every `.sql` file in `apps/api/prisma/migrations_manual/` — it's
   idempotent, safe to re-run any time (e.g. after pulling a new manual migration file).

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
