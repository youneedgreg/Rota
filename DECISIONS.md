# Decisions

Short records of choices that shape Rota, newest first. Each says what was decided, why, and what would change it.

## 2026-11-14 · Local setup with Docker Compose

**One command: `docker compose up --build`** starts the web app and a strfry relay. Both ports are published on 127.0.0.1 only.

**strfry pinned to its multi-arch index digest** (`ghcr.io/hoytech/strfry`, version 1.1.2-148, built 2026-09-04), so the same image runs on Apple silicon and amd64. Its default config listens on 127.0.0.1 inside the container, so Compose passes `--set relay.bind=0.0.0.0` instead of committing a copy of strfry's (GPL) config file. Relay data lives in a named volume and survives restarts (checked).

**The web app builds as Next.js standalone output** in a multi-stage `node:24-alpine` image (293 MB) that runs as the `node` user. `NEXT_PUBLIC_RELAY_URL` is a build argument because the browser, not the container, connects to the relay.

## 2026-11-14 · Project setup

**Layout: a pnpm workspace.** `apps/web` is the Next.js PWA; `packages/receipts` is the receipt checker. The checker is meant to ship as its own MIT package that any Lightning app can use, so it lives in its own folder with its own tests from the first commit. Until it is published it is marked `private` and exports its TypeScript source; the web app consumes it through the workspace.

**Package name: `@rota/receipts`,** if the `rota` scope can be registered on npm before publishing. If not, it gets an unscoped name.

**Next.js 16.4.6, React 19.3, Tailwind 4.3, Node 24.** The current stable releases; Node 24 is the active LTS.

**TypeScript 6.0.3, not 7.** TypeScript 7.0.2 is the latest release, but its package no longer exposes the classic compiler API, which Next.js's type checking and typescript-eslint rely on (typescript-eslint 8.72 supports TypeScript below 6.1). Revisit when both support 7.

**ESLint 9, not 10.** `eslint-config-next` pulls in eslint-plugin-react, -import and -jsx-a11y, whose current releases accept ESLint 9 at most. ESLint 9 is out of support upstream; move to 10 when those plugins do.

**Vitest 5** for tests, starting with the receipt checks.

**Mainnet, small amounts.** The demo runs on Bitcoin mainnet with small amounts so the payout to M-Pesa is real. Unit tests use recorded invoices and generated fixtures, never live payments. Committed fixtures never contain a real phone number: invoices paid to a phone-number Lightning address stay out of the repo, because that address's metadata names the number.

## Day-1 checks

Results are recorded here as each check runs.

| Check | Result | Decision |
|---|---|---|
| Breez API key | Requested 2026-11-13; waiting | — |
| Built-in wallet in the browser | Not run | — |
| NWC pay-only with a cap | Not run | — |
| M-Pesa payout through `number@bitcoin.co.ke` | Not run | — |
| Address in the invoice (description hash) | Not run | — |
| Browser fetch of LNURL (CORS) | Not run | — |
| LUD-21 verify URL | Not run | — |
| Prices (BTC/EUR, BTC/KES) | Not run | — |
| Relay (strfry, NIP-44) | Not run | — |
