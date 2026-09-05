# Stockora web (Next.js) — build from the REPO ROOT as context:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://stockora.abbadev.com -t stockora-web .
#
# IMPORTANT: NEXT_PUBLIC_API_URL (and NEXT_PUBLIC_DEMO_MODE) are inlined into the
# client bundle at BUILD time. NEXT_PUBLIC_API_URL must be the PUBLIC origin the
# browser will use (no trailing /api — the client appends /api itself). Rebuild
# the image if either value changes.
# ---------------------------------------------------------------------------

FROM node:20-slim AS base
WORKDIR /app

# ---- build ----
# NOTE: do NOT set NODE_ENV here. `npm ci` installs devDependencies regardless
# of NODE_ENV (npm 7+ needs an explicit --omit=dev to skip them), and `next
# build` must run with NODE_ENV unset/production — a leaked NODE_ENV=development
# makes it mix its dev and prod runtime bundles mid-render, crashing every page
# with "Cannot read properties of null (reading 'useContext')" during static
# generation.
FROM base AS build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_DEMO_MODE=false
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages/contracts packages/contracts
COPY apps/web apps/web
# turbo builds @iw/contracts first, then next build for @iw/web.
RUN npx turbo run build --filter=@iw/web...

# ---- runtime (next start) ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/turbo.json ./
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/apps/web ./apps/web
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
