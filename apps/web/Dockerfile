# Stockora web (Next.js) — build from the REPO ROOT as context:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://stockora.abbadev.com -t stockora-web .
#
# IMPORTANT: NEXT_PUBLIC_API_URL is inlined into the client bundle at BUILD time.
# It must be the PUBLIC origin the browser will use (no trailing /api — the client
# appends /api itself). Rebuild the image if this value changes.
# ---------------------------------------------------------------------------

FROM node:20-slim AS base
WORKDIR /app

# ---- build ----
FROM base AS build
ENV NODE_ENV=development
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
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
