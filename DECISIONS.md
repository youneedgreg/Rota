# Decisions

Short records of choices that shape Rota, newest first. Each says what was decided, why, and what would change it.

## 2026-11-14 · Circles, amounts and paying an address

The circle model, price conversion and invoice checks live in `packages/circles` (`@rota/circles`), pure TypeScript that the web app, a seed script or a server can share. `@rota/receipts` stays small, because it's meant to be published on its own.

**The recipient doesn't pay into their own round.** Members pay the recipient directly, so paying yourself would only cost fees. A round's pot is (members − 1) × contribution, and a circle of n members has n rounds in payout order.

**Weekly, monthly or demo rounds, with a grace period.** A payment is late once the round's grace period has passed (days for weekly and monthly, minutes for demo rounds, which the video and the judge path use). Monthly rounds count from the start date each time, so a circle that starts on the 31st opens on the last day of shorter months and goes back to the 31st after. A payment counts only if its receipt passed the four checks; the status code decides paid, pending or late, not whether a payment happened.

**Sats are worked out on the payer's phone, at pay time.** Rota's server never sets the amount. For most addresses the phone uses the market price (CoinGecko, Coinbase if CoinGecko fails or is more than 10 minutes old, cached for 60 seconds) and XOF = EUR × 655.957. Amounts are rounded up to a whole sat, so the recipient never gets less. Members' sats for the same round can differ slightly; each receipt records the exact amount paid.

**M-Pesa recipients get the exact shillings.** When an address quotes KES itself (bitcoin.co.ke's `currency.multiplier`), the phone uses that rate, after checking that the bitcoin price it implies is within 5% of the market price. 5% is Rota's own margin, enough for a service's spread and short enough to refuse a broken or hostile rate. M-Pesa payouts are KES-only: an XOF circle would need a second conversion before every payment.

**M-Pesa numbers are stored as 2547XXXXXXXX@bitcoin.co.ke.** Asked about a 07… number, bitcoin.co.ke's metadata names the 2547… form, and receipt check 2 compares the two. Rota rewrites 07…, 01…, 254… and +254… numbers to that form when the circle is created and refuses anything that isn't a Kenyan mobile number.

**Its minimum is a little above its own rate.** On 2026-11-14 bitcoin.co.ke accepted 15 KES but asked for at least 178 sats, while 15 KES at its own rate was 176 sats. For an amount within the service's own range, Rota sends the service's minimum when its rate falls short; the recipient gets a little more.

**The invoice is checked before any wallet sees it.** The phone fetches the address's pay parameters (their metadata must name exactly that address), asks for an invoice for the computed amount, and refuses it unless it is on mainnet, for exactly that amount, tied to the address (description hash, or for bitcoin.co.ke the signed description), signed by the node recorded at setup, and valid for at least 15 more seconds. Redirects are refused, so the phone only talks to the address's own domain (neither bitcoin.co.ke nor getalby.com redirected on 2026-11-14). When a circle is set up, each payout address is probed once with an unpaid invoice to record its node key. Not yet seen: whether bitcoin.co.ke always signs with the same node; the circle keeps a list of keys in case it doesn't.

## 2026-11-14 · Local setup with Docker Compose

**One command: `docker compose up --build`** starts the web app and a strfry relay. Both ports are published on 127.0.0.1 only.

**strfry pinned to its multi-arch index digest** (`ghcr.io/hoytech/strfry`, version 1.1.2-148, built 2026-09-04), so the same image runs on Apple silicon and amd64. Its default config listens on 127.0.0.1 inside the container, so Compose passes `--set relay.bind=0.0.0.0` instead of committing a copy of strfry's (GPL) config file. Relay data lives in a named volume and survives restarts (checked).

**The web app builds as Next.js standalone output** in a multi-stage `node:24-alpine` image (293 MB) that runs as the `node` user. `NEXT_PUBLIC_RELAY_URL` is a build argument because the browser, not the container, connects to the relay.

## 2026-11-14 · Day-1 checks without money

Run on 2026-11-14 from a Mac, sending a browser `Origin` header. No payment was made; the only invoice created was left unpaid. The bitcoin.co.ke checks used a dummy phone number, never a real one.

**bitcoin.co.ke invoices carry a plain description, not a description hash.** The LNURL metadata names the address (`text/identifier` is `<number>@bitcoin.co.ke`), but the invoice holds the text "Payment to <number>@bitcoin.co.ke" instead of SHA-256 of that metadata. So receipt check 2 ("to this address") reads the address from the signed description for this service, and checks the description hash where a service sets one. That's weaker: it ties the invoice to the address text, not to the published metadata. The README says so. Still open: whether strict wallets refuse these invoices; the first real payment will show it.

**Invoices from bitcoin.co.ke expire after 120 seconds,** so the app fetches the invoice when the member taps Pay, not before.

**No LUD-21; Tando's status API may stand in for it.** The callback returns no `verify` URL. Its `successAction` links to a receipt page that reads `api.tando.ltd/v2/transactions/btcpay/payment-hash/<hash>`, which allows browser requests and answered `status: "pending", isPaid: false` for the unpaid invoice. It's undocumented, so Rota treats it as a convenience for members who pay by QR, never as proof. What it returns for a paid invoice is not yet seen.

**Range 15 to 50,000 KES,** from the service's own `currency` field (the roadmap said 10,000 at the top). Minimum on the day: 178 sats.

**Prices: CoinGecko, with Coinbase as the fallback.** CoinGecko's keyless `simple/price` returns BTC in EUR, KES and XOF with a timestamp, allows browser requests and lets responses be cached for 30 to 60 seconds. Coinbase's `exchange-rates` matched it to within 0.1%. Yadio's KES was about 1.3% higher than both. mempool.space has no KES. XOF is computed as EUR × 655.957 (CoinGecko's own XOF matched this exactly). CoinGecko's current keyless rate limits were not checked, so prices are cached and the fallback is wired in.

**Amounts to bitcoin.co.ke use Tando's own rate.** The shillings that reach M-Pesa depend on Tando's rate, which the LNURL response gives as `currency.multiplier` (msat per KES). For those recipients the app turns KES into sats with that quote, fetched on the payer's phone. The price API is for display and for other Lightning addresses.

**Relay: strfry, pinned by digest.** `ghcr.io/hoytech/strfry` (version 1.1.2-148, arm64 digest `sha256:1b2a6fe1…87bb`). Its default config binds to 127.0.0.1 inside the container, so Rota mounts a config with `bind = "0.0.0.0"` and publishes the port on the host's localhost only. One NIP-44 encrypted event (kind 30078, throwaway keys, fake content) was published, read back by id, its signature verified and its content decrypted to the original. NIP-44 is done in the app; the relay only stores ciphertext.

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
| Breez API key | Received 2026-11-14; kept in a local, git-ignored env file | Where it must live (browser or server) is checked before the wallet is built |
| Built-in wallet in the browser | Not run | — |
| NWC pay-only with a cap | Not run | — |
| M-Pesa payout through `number@bitcoin.co.ke` | Not run | — |
| Address in the invoice (description hash), bitcoin.co.ke | No hash; the signed description names the address | Check 2 reads the description for this service |
| Address in the invoice, one other Lightning address | Not run (waits for a wallet) | — |
| Browser fetch of LNURL (CORS), bitcoin.co.ke | Pass (`Access-Control-Allow-Origin: *` on metadata and callback) | Fetch in the browser; no proxy |
| LUD-21 verify URL, bitcoin.co.ke | Not offered | Tando's status API as a convenience only |
| Prices (BTC/EUR, BTC/KES) | Pass (CoinGecko; Coinbase within 0.1%) | CoinGecko, Coinbase fallback, XOF = EUR × 655.957 |
| Relay (strfry, NIP-44) | Pass | strfry pinned by digest, bound to localhost |
