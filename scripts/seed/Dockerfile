# The local demo's seed (see compose.yaml): publishes the fictional demo
# circle to the relay once, then exits.
#   docker build -f scripts/seed/Dockerfile .

FROM node:24-alpine
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/receipts/package.json packages/receipts/
COPY packages/circles/package.json packages/circles/
COPY packages/records/package.json packages/records/
COPY scripts/seed/package.json scripts/seed/
RUN pnpm install --frozen-lockfile --prod --filter @rota/seed...
COPY tsconfig.base.json ./
COPY packages/receipts packages/receipts
COPY packages/circles packages/circles
COPY packages/records packages/records
COPY scripts/seed scripts/seed
USER node
CMD ["pnpm", "--filter", "@rota/seed", "start"]
