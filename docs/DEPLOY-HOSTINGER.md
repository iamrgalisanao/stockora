# Deploying Stockora on a Hostinger VPS (Docker + Traefik)

This deploys the whole stack — **Postgres + NestJS API + Next.js web** — as one
Docker Compose project, routed by your **existing Traefik** on a single subdomain:

| URL | Serves |
| --- | --- |
| `https://stockora.abbadev.com/` | Web (Next.js) |
| `https://stockora.abbadev.com/api` | API (NestJS, global prefix `/api`) |

The browser talks to the API on the **same origin** (`/api`), so there are no CORS
or second-certificate headaches, and it uses the one DNS record you already made.

Files involved (all in the repo):
- `apps/api/Dockerfile`, `apps/web/Dockerfile` — build the two images (context = repo root).
- `deploy/docker-compose.prod.yml` — the stack + Traefik labels.
- `deploy/.env.prod.example` — copy to `deploy/.env.prod` and fill in.

---

## 0. Prerequisites

- DNS: `stockora.abbadev.com` → your VPS IP (`76.13.215.21`). ✅ already done.
- SSH access to the VPS; `docker` and `docker compose` available. ✅
- `git` on the VPS.

---

## 1. Get the code onto the VPS

The repo is **private**, so authenticate with a GitHub Personal Access Token
(PAT) when cloning, or add a deploy key. Pick a home for it (your other apps live
under `/var/www` and `/opt`):

```bash
cd /opt
git clone https://github.com/iamrgalisanao/stockora.git
cd stockora
```

When prompted, username = `iamrgalisanao`, password = a PAT with `repo` scope
(GitHub → Settings → Developer settings → Personal access tokens).

---

## 2. Detect your Traefik settings (network + cert resolver)

The compose routes via Traefik labels, so it must join the **same docker network**
your Traefik uses and reference the **same Let's Encrypt resolver name**. The
fastest way is to copy both from a neighbouring app that already serves HTTPS
(e.g. `itrack`, `ihris`, `crmsales`).

```bash
# 1) Find the running containers and the proxy
docker ps --format '{{.Names}}\t{{.Image}}'

# 2) Copy the network + entrypoints + certresolver from an app that already has TLS.
#    Replace <app> with a real container name from the list above (e.g. itrack-app-1).
docker inspect <app> -f '{{json .Config.Labels}}' | tr ',' '\n' \
  | grep -iE 'traefik.docker.network|entrypoints|certresolver'
```

You are looking for three values:
- `traefik.docker.network=...`  → put in `PROXY_NETWORK`
- `...entrypoints=...` (usually `websecure`) → this compose already uses `websecure`; change it in `deploy/docker-compose.prod.yml` if yours differs.
- `...tls.certresolver=...` → put in `CERT_RESOLVER`

Confirm Traefik actually watches docker labels (it must, for this to work):

```bash
TRAEFIK=$(docker ps --format '{{.Names}}' | grep -i traefik | head -1)
docker inspect "$TRAEFIK" -f '{{json .Args}}' | tr ',' '\n' | grep -iE 'providers.docker|entrypoints|certificatesresolvers'
```

- If you see `--providers.docker=true` → labels work; continue with Step 3 (recommended path).
- If Traefik uses only a **file provider** (no docker provider), your panel manages
  routing itself → jump to **Appendix A** (deploy via the panel UI).

> Tip: if your neighbours' HTTPS is issued differently (e.g. the panel terminates
> TLS), Appendix A is the safer route.

---

## 3. Configure environment

```bash
cp deploy/.env.prod.example deploy/.env.prod
# generate a strong JWT secret
openssl rand -hex 32
nano deploy/.env.prod
```

Fill in:
- `PROXY_NETWORK` and `CERT_RESOLVER` — from Step 2.
- `POSTGRES_PASSWORD` — a long random string.
- `JWT_SECRET` — the `openssl rand -hex 32` output.
- Leave `APP_URL` / `APP_HOST` as the stockora subdomain.

`deploy/.env.prod` is gitignored — it never gets committed.

---

## 4. Build and start

```bash
docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml up -d --build
```

First build takes a few minutes (installs deps, builds contracts + API + Next).
The API container runs `prisma migrate deploy` automatically on start, creating
all tables.

Watch it come up:

```bash
docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml ps
docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml logs -f api
```

You want to see `Prisma migrate deploy` finish, then `API listening ... /api`.

---

## 5. Verify

```bash
# From the VPS — a JSON 404 from Nest means the API is reachable through Traefik.
# (A plain-text "404 page not found" instead means the /api route isn't matching.)
curl -sk https://stockora.abbadev.com/api

# The web should return HTML
curl -skI https://stockora.abbadev.com/ | head -1
```

Then open **https://stockora.abbadev.com** in a browser:
1. Click **Register a new organization**.
2. Create your org + admin account.

Registration self-provisions all roles and permissions transactionally — **no seed
step is needed.** (If you *want* the demo dataset instead, see Appendix B.)

---

## 6. Updating after you push new code

```bash
cd /opt/stockora
git pull
docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml up -d --build
```

New migrations apply automatically on API restart. Your Postgres data persists in
the `stockora_pgdata` volume across rebuilds.

---

## Appendix A — Panel-managed routing (Dokploy/Coolify-style)

If Traefik doesn't watch docker labels, deploy the stack and let the panel route it:

1. In the panel, create a **Compose** service pointing at this repo (or paste
   `deploy/docker-compose.prod.yml`), with env from `deploy/.env.prod`.
2. Remove/ignore the `traefik.*` labels (the panel adds its own).
3. In the panel's **Domains** UI add two mappings on `stockora.abbadev.com`:
   - Path `/api` → service **api**, port **4000**
   - Path `/`    → service **web**, port **3000**
   Enable "HTTPS / Let's Encrypt" on both.

The panel then issues the certificate and wires Traefik for you.

---

## Appendix B — Optional demo data

To load the demo organisation (`admin@demo.test` / `password123`) and a sample
catalog instead of registering your own:

```bash
docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml exec api npm run seed -w @iw/api
```

---

## Troubleshooting

- **`network <name> not found`** → `PROXY_NETWORK` is wrong; re-check Step 2. The
  network must already exist (Traefik created it) and be `external: true`.
- **Traefik "404 page not found" at the domain** → the router didn't match. Confirm
  the api/web containers are on `PROXY_NETWORK` (`docker inspect <container> -f '{{json .NetworkSettings.Networks}}'`) and that `entrypoints`/`certresolver` names match your Traefik.
- **TLS not issued** → wrong `CERT_RESOLVER` name, or port 80 isn't reachable for
  the ACME HTTP challenge. Copy the resolver name from a working neighbour app.
- **Web build runs out of memory** on a small VPS → add swap, or build the images
  on a bigger machine and push to a registry, then `image:` them here.
- **API can't reach the DB** → check `docker compose ... logs postgres`; the
  `DATABASE_URL` host must be `postgres` (the service name), which it is by default.
