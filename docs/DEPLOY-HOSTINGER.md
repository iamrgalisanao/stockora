# Deploying Stockora on the Hostinger VPS (srv1423476)

This deploys the whole stack — **Postgres + NestJS API + Next.js web** — as one
Docker Compose project, fronted by **the VPS's own Apache** (confirmed to be the
real internet-facing edge on this box — see "Why Apache, not Traefik" below) on
a single subdomain:

| URL | Serves |
| --- | --- |
| `https://stockora.abbadev.com/` | Web (Next.js) |
| `https://stockora.abbadev.com/api` | API (NestJS, global prefix `/api`) |

The browser talks to the API on the **same origin** (`/api`), so there's no
CORS or second-certificate headache.

Files involved (all in the repo):
- `apps/api/Dockerfile`, `apps/web/Dockerfile` — build the two images (context = repo root).
- `deploy/docker-compose.prod.yml` — the stack; publishes `web`/`api` to loopback ports for Apache to proxy to.
- `deploy/.env.prod.example` — copy to `deploy/.env.prod` and fill in.
- `deploy/demo-reset.sh` — nightly wipe-and-reseed for the public demo (see "Demo mode" below).

This VPS's `stockora.abbadev.com` instance runs with **demo mode on** — see
"Demo mode" below for what that changes and why.

---

## Why Apache, not Traefik

This VPS also runs a `traefik` container (visible in `docker ps`), which looks
at first glance like the thing to route through. **It isn't, for real traffic.**
Confirmed by inspection on 2026-09-05:

- `docker port traefik` → empty. Traefik has **no ports published to the host**.
- `ss -tlnp | grep -E ':80 |:443 '` → **apache2** owns both ports.
- `apache2ctl -S` lists a `-le-ssl.conf`/`.conf` vhost pair per app (itrack,
  ipos, crmsales, ihris, n8n, openclaw, ...), each reverse-proxying
  (`ProxyPass`/`ProxyPassReverse`) to a `127.0.0.1:<port>` where that app's
  container publishes its web port, with TLS issued by **certbot's Apache
  plugin** (`certbot --apache`).

So a container's Traefik labels are inert here — nothing ever reaches Traefik
from outside. Stockora follows the same Apache + certbot pattern as every
other app on this box.

---

## 0. Prerequisites

- DNS: `stockora.abbadev.com` → `76.13.215.21` (this VPS). ✅ already confirmed.
- SSH access; `docker`, `docker compose`, `apache2`, `certbot` present. ✅

---

## 1. Get the code onto the VPS

The repo is **public**, so no credentials are needed:

```bash
cd /opt
git clone https://github.com/iamrgalisanao/stockora.git
cd stockora
```

To update later: `git pull` from `/opt/stockora`.

---

## 2. Configure environment

```bash
cd /opt/stockora
cp deploy/.env.prod.example deploy/.env.prod
openssl rand -hex 32
nano deploy/.env.prod
```

Fill in:
- `POSTGRES_PASSWORD` — a long random string.
- `JWT_SECRET` — the `openssl rand -hex 32` output. **Must be ≥32 characters** —
  the API refuses to boot otherwise (`Invalid environment configuration: JWT_SECRET
  must be at least 32 characters in production`).
- `WEB_HOST_PORT` / `API_HOST_PORT` — leave the defaults (`18300`/`18400`) unless
  something else on the VPS already uses them.
- Leave `APP_URL` / `APP_HOST` as the stockora subdomain.
- `DEMO_MODE` — set to `true` for the public demo (see "Demo mode" below), `false`
  for a real customer instance.

`deploy/.env.prod` is gitignored — it never gets committed.

---

## 3. Build and start the containers

```bash
docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml up -d --build
```

Watch it come up:

```bash
docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml ps
docker logs -f stockora-api-1
```

Wait for `API listening on http://localhost:4000/api` and confirm it's **not**
restarting. Then sanity-check the loopback ports directly (before Apache is
wired up):

```bash
curl -sI http://127.0.0.1:${WEB_HOST_PORT:-18300}/   | head -1   # expect 200
curl -s  http://127.0.0.1:${API_HOST_PORT:-18400}/api            # expect a Nest 404 JSON body
```

---

## 4. Add the Apache vhost

Create the port-80 vhost. **Do not** add an HTTPS-redirect block yourself —
certbot adds that automatically in Step 5, matching every other app on this box:

```bash
sudo tee /etc/apache2/sites-available/stockora.abbadev.com.conf > /dev/null <<'EOF'
<VirtualHost *:80>
    ServerName stockora.abbadev.com

    ProxyPreserveHost On
    ProxyPass /api http://127.0.0.1:18400/api
    ProxyPassReverse /api http://127.0.0.1:18400/api
    ProxyPass / http://127.0.0.1:18300/
    ProxyPassReverse / http://127.0.0.1:18300/

    ErrorLog ${APACHE_LOG_DIR}/stockora-error.log
    CustomLog ${APACHE_LOG_DIR}/stockora-access.log combined
</VirtualHost>
EOF
```

> If you changed `WEB_HOST_PORT`/`API_HOST_PORT` from the defaults in Step 2,
> edit the two port numbers above to match.

`/api` is listed **before** `/` on purpose — Apache's `ProxyPass` directives
match in the order they're declared, so the more specific path must come first
or every request would fall through to the web container.

Enable it:

```bash
sudo a2ensite stockora.abbadev.com.conf
sudo apache2ctl configtest   # must print "Syntax OK"
sudo systemctl reload apache2
```

Verify plain HTTP now reaches the app (the redirect-to-HTTPS doesn't exist
yet, so this should show the app, not a redirect):

```bash
curl -sI -H "Host: stockora.abbadev.com" http://127.0.0.1/ | head -1
```

---

## 5. Issue the TLS certificate

```bash
sudo certbot --apache -d stockora.abbadev.com
```

Certbot will detect the vhost by its `ServerName`, obtain the Let's Encrypt
cert, write `/etc/apache2/sites-available/stockora.abbadev.com-le-ssl.conf`,
and offer to redirect HTTP → HTTPS — **accept that**, to match every other app
on this box. It reloads Apache itself.

---

## 6. Verify

```bash
curl -skI https://stockora.abbadev.com/ | head -1
curl -sk  https://stockora.abbadev.com/api
```

Then open **https://stockora.abbadev.com** in a browser.

- **`DEMO_MODE=false`** (a real customer instance): click **Register a new
  organization** to create your org + admin account. Registration
  self-provisions all roles and permissions transactionally — no seed step needed.
- **`DEMO_MODE=true`** (this VPS's public demo): the login page already lists
  the seeded per-role logins (see "Demo mode" below) — pick one and sign in.
  Registration is still technically reachable but pointless here: anything it
  creates is wiped by the nightly reset along with everything else.

---

## 7. Updating after you push new code

```bash
cd /opt/stockora
git pull
docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml up -d --build
```

New Prisma migrations apply automatically on API restart. Postgres data
persists in the `stockora_pgdata` named volume across rebuilds. The Apache
vhost and certificate need no changes for ordinary code updates.

**If you changed `DEMO_MODE`** in `deploy/.env.prod`, you must pass `--build`
(as above) — it's baked into the `web` image at build time, so a plain
`up -d` without a rebuild won't pick up the change.

---

## Demo mode

`DEMO_MODE=true` turns this exact same codebase into a public, self-serve demo.
It changes two things, both gated on the single `DEMO_MODE` env var (read by
the API directly, and passed to the web build as `NEXT_PUBLIC_DEMO_MODE`):

1. **Login page** shows a "Demo accounts" panel listing all 9 seeded per-role
   logins (`admin@demo.test`, `inventory_manager@demo.test`, ...,
   `viewer@demo.test`, all password `password123` — see
   `apps/api/prisma/seed.ts` `ensureDemoRoleUsers()`), each a one-click fill.
2. **API blocks account/security mutations** (`apps/api/src/common/demo-mode.middleware.ts`)
   so one visitor can't disrupt another sharing the same login: creating or
   editing users, editing organization settings, and configuring outbound
   webhooks all return `403 {"error":"Demo Mode", ...}`. Everything else — the
   actual inventory workflows the demo exists to show off — works normally.

### Nightly reset

Since many visitors share the same seeded accounts over a day, `deploy/demo-reset.sh`
drops and recreates the database (migrations + seed, via `prisma migrate reset
--force`) so it wakes up every morning in its original state. It refuses to run
unless `deploy/.env.prod` has `DEMO_MODE=true` — a real customer's data can never
be wiped by this script, even by mistake.

Wire it into root's crontab, nightly at 02:00 server time:

```bash
sudo crontab -e
# add this line:
0 2 * * * /opt/stockora/deploy/demo-reset.sh >> /var/log/stockora-demo-reset.log 2>&1
```

Test it manually first (it prints what it's doing, and aborts loudly if the
DEMO_MODE guard isn't satisfied):

```bash
sudo /opt/stockora/deploy/demo-reset.sh
```

---

## Appendix A — Optional demo data

To load the demo organisation (`admin@demo.test` / `password123`) and a sample
catalog instead of registering your own:

```bash
docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml exec api npm run seed -w @iw/api
```

---

## Troubleshooting

- **API container keeps restarting, logs show `JWT_SECRET: must be at least 32
  characters`** → `deploy/.env.prod` still has the placeholder value. Generate
  a real one (`openssl rand -hex 32`) and `docker compose ... up -d api` to
  recreate just that container (no rebuild needed — env isn't baked into the image).
- **Visiting the domain shows the AbbaDev marketing site instead of Stockora**
  → the Apache vhost isn't enabled/matched yet. Re-check Step 4:
  `apache2ctl -S` should list `stockora.abbadev.com` under both `*:80` and
  `*:443`; if it's missing, `a2ensite` didn't run or `apache2ctl configtest`
  failed silently — rerun it and read its output.
- **`apache2ctl configtest` fails** → usually a stray character in the heredoc;
  `cat /etc/apache2/sites-available/stockora.abbadev.com.conf` and compare
  against Step 4 exactly.
- **`curl http://127.0.0.1:18300/` (or `:18400`) refused** → the container
  isn't up, or `WEB_HOST_PORT`/`API_HOST_PORT` in `deploy/.env.prod` don't match
  what the Apache vhost points at. `docker ps --format '{{.Names}}\t{{.Ports}}'
  | grep stockora` to check the real bound ports.
- **`certbot --apache` fails the HTTP-01 challenge** → port 80 must be reachable
  from the internet for `stockora.abbadev.com` and the Step 4 vhost must already
  be live (`curl -H "Host: stockora.abbadev.com" http://127.0.0.1/` working)
  before you run certbot.
- **Saving webhooks / editing a user returns `403 {"error":"Demo Mode",...}`**
  → expected behaviour when `DEMO_MODE=true` — see "Demo mode" above. Not a bug.
- **`deploy/demo-reset.sh` aborts with "DEMO_MODE is not 'true'"** → intentional
  safety guard; it only ever runs against a deployment explicitly marked as the
  public demo. If this VPS's instance really is the demo, check `deploy/.env.prod`
  has the exact line `DEMO_MODE=true` (no quotes, no trailing text).
- **Login page doesn't show the demo-accounts panel even though `DEMO_MODE=true`**
  → it's a build-time flag (`NEXT_PUBLIC_DEMO_MODE`), not a runtime one. Rebuild
  the web image (`up -d --build`), not just restart it.
- **Web build runs out of memory** on a constrained VPS → add swap, or build
  the images elsewhere and push to a registry, then reference `image:` here
  instead of `build:`.
- **API can't reach the DB** → `docker compose ... logs postgres`; the
  `DATABASE_URL` host must be `postgres` (the service name), which it is by default.
