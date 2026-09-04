# Stockora API (NestJS + Prisma) — build from the REPO ROOT as context:
#   docker build -f apps/api/Dockerfile -t stockora-api .
# ---------------------------------------------------------------------------

# ---- base: Debian slim + OpenSSL (Prisma engines need it) ----
FROM node:20-slim AS base
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- build: install ALL deps, build @iw/contracts + @iw/api, generate Prisma ----
# NOTE: do NOT set NODE_ENV here — npm ci installs devDependencies regardless
# (npm 7+ needs an explicit --omit=dev to skip them), and a leaked
# NODE_ENV=development into the runtime stage's tooling is a needless footgun
# (see apps/web/Dockerfile, where the same leak broke `next build` outright).
FROM base AS build
# Manifests first for a cached install layer.
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
# Sources needed to build the API and its workspace dependency.
COPY packages/contracts packages/contracts
COPY apps/api apps/api
# The Prisma client MUST be generated before `nest build`: the API's TypeScript
# imports types (e.g. AdjustmentStatus, Prisma.Decimal) straight off the
# generated client, so tsc fails with "no exported member" if this runs after.
RUN npm run prisma:generate -w @iw/api
# turbo builds @iw/contracts first (dependency), then @iw/api.
RUN npx turbo run build --filter=@iw/api...

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
# node_modules carries the generated Prisma client, the Prisma CLI (for
# migrate deploy) and ts-node (for the one-off seed).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json /app/turbo.json ./
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/apps/api ./apps/api
EXPOSE 4000
# Apply pending migrations, then boot. (Seed is a manual one-off — see the guide.)
CMD ["sh", "-c", "npm run prisma:deploy -w @iw/api && node apps/api/dist/main.js"]
