# Builds the Rota web app from the repo root (see compose.yaml):
#   docker build -f apps/web/Dockerfile .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Manifests first so the dependency layer is cached between code changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/receipts/package.json packages/receipts/
COPY packages/wallet/package.json packages/wallet/
RUN pnpm install --frozen-lockfile --filter @rota/web...
COPY tsconfig.base.json ./
COPY packages/receipts packages/receipts
COPY packages/wallet packages/wallet
COPY apps/web apps/web
ARG NEXT_PUBLIC_RELAY_URL=ws://localhost:7777
ENV NEXT_PUBLIC_RELAY_URL=$NEXT_PUBLIC_RELAY_URL
# The built-in wallet's network and Breez key are inlined into the browser
# bundle at build time (the key is public by design; it ships to every phone).
ARG NEXT_PUBLIC_BREEZ_NETWORK=regtest
ENV NEXT_PUBLIC_BREEZ_NETWORK=$NEXT_PUBLIC_BREEZ_NETWORK
ARG NEXT_PUBLIC_BREEZ_API_KEY=
ENV NEXT_PUBLIC_BREEZ_API_KEY=$NEXT_PUBLIC_BREEZ_API_KEY
RUN pnpm --filter @rota/web build

FROM node:24-alpine AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
# Next's standalone output: a minimal server plus only the files it needs.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
