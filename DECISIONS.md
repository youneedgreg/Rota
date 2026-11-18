# Decisions

Short records of choices that shape Rota, newest first. Each says what was decided, why, and what would change it.

## 2026-11-18 · The receipt checker on npm

**Name: `lightning-receipts`, unscoped,** because it's useful to any Lightning app, not only Rota, and the name says what it does. It was free on npm on 18 Nov. The workspace uses the same name, so Rota's code imports it the way anyone else would.

**What ships:** the decoder and the four checks, built to ES modules with type declarations (`dist/`), plus the README and the MIT licence: 9 files, about 8 KB packed. The fake-invoice helper (`./testing`) stays out; Rota's tests and the demo seed use it from the workspace. Works in browsers and Node 20.19 or later (the `@noble` packages need 20.19).

**Workspace source, published build.** Inside the repo the package still exports its TypeScript source, so Next and Vitest need no build step. `publishConfig.exports` points the published package at `dist/` instead. pnpm applies that when it packs, npm doesn't, so **publish with `pnpm publish`, not `npm publish`.** The source imports its own files without an extension (Turbopack can't map `./x.js` back to `x.ts`), so after `tsc` a small script, `add-js-extensions.mjs`, adds `.js` to relative imports in `dist/` for Node.

**Checked from the packed tarball,** installed into an empty folder from the registry's copies of its three dependencies:
- a generated receipt passes all four checks with the strong address proof;
- a wrong preimage, address or amount fails exactly that check, and a tampered invoice throws `InvoiceError`;
- it loads with both `import` and `require()` on Node 24;
- a TypeScript consumer with `moduleResolution: nodenext` sees the types and can't import `./testing`.

Not tested on Node 20.

## 2026-11-18 · The seeded demo circle

**`docker compose up` seeds a fictional circle in round 3, with rounds 1 and 2 paid and proven.** A one-shot `seed` service (`scripts/seed`) publishes it to the local relay and prints a view-only invite link plus one demo login per member (`docker compose logs seed`). Five members (Amina, Baraka, Wanjiru, Otieno, Fatou) pay 1,000 KES a month to `<name>@example.com`, a domain reserved by RFC 2606, so no address or phone number belongs to anyone real. Round 1 has one late payment; round 3 opened two or three days before the seed ran, with Amina and Otieno paid and Baraka and Fatou still to pay.

**The receipts pass all four checks, but no money moved.** Their invoices are signed with demo node keys, their amounts come from the day's price, and every key is derived from a public label, so anyone can recreate them. That is why the seed runs on regtest only and refuses any other network: fake-paid receipts must never sit next to real circles, and the hosted mainnet demo gets real rounds instead. Amounts are judged against ±20% of today's price, so after a big price move the seeded receipts start failing the amount check; seeding a fresh relay fixes that.

**Seeding again keeps the first circle.** The NIP-44 encryption makes event ids differ each run, so the seed looks for a definition from the demo organizer's key on the relay and, if it finds one, prints that circle's links and publishes nothing. The links stay the same until the relay's volume is removed.

**Demo logins replace the browser's member key, on regtest only.** A login link is `/demo#<member secret>.<invite>`. The page shows who you'll be and asks before replacing an existing member key. On mainnet the page refuses every link: a link that swaps in a key someone else knows would let them sign as you. The hosted judge path needs its own way in (step J).

**The seed runs with `tsx` 4.23.15** (published 20 Sep 2026): the packages import their files without extensions, which Node's own TypeScript support doesn't resolve.

## 2026-11-18 · Security pass

**The threat model is written down in [THREAT_MODEL.md](THREAT_MODEL.md),** with the code behind each defence and the gaps in order of risk. The main finding: the "one contribution a month, nothing else" claim holds for NWC connections only. A compromised web host could serve code that reads the built-in wallet when the member types their PIN. The advice for now is to keep about one contribution in the built-in wallet.

**Error reports go to Sentry, off unless a DSN is set, and scrubbed on the phone.** Only the browser SDK (`@sentry/browser` 11.10.0) is used; Rota has no server code to watch. It loads only when `NEXT_PUBLIC_SENTRY_DSN` is set, with Sentry's default integrations off: no breadcrumbs (they record clicks and URLs), no tracing, no session replay. Before a report leaves, `scrubReport` drops the request, breadcrumbs, user and extra data, removes everything after `#` or `?` in any URL (invite secrets live after `#`), and blanks invoices, NWC strings, `nsec` keys, Lightning and e-mail addresses, phone numbers and long hex. Sentry's own server-side scrubbing should be on as well. The DSN is public by design: it can only send reports.

**Security headers, with a Content-Security-Policy that has no nonce.** The pages are pre-rendered static files, and a nonce needs a server rendering every request, so scripts are limited to Rota's own origin plus `'unsafe-inline'` for Next's inline bootstrap. `'wasm-unsafe-eval'` lets the Breez SDK compile its WebAssembly; plain `eval` is blocked in production. `connect-src` allows any `https:` and `wss:` host because members pay arbitrary Lightning addresses and may use any relay; plain `http:` is blocked, except the local relay in development. The page can't be framed, and the camera, microphone, location, payment and USB APIs are off. Checked on a production build: the built-in wallet starts, creates an invoice and checks a pasted one, the price API and relay connect, and no violations are reported. What would change it: a server-rendered host, which would allow a nonce in place of `'unsafe-inline'`.

**LNURL requests go to public host names only.** A circle's addresses come from other members, so a hostile address could point a member's browser at their router or another local service. `payParamsUrl` refuses an address that isn't already in its normal form, and every callback and verify URL must be HTTPS to a public DNS name: no IP addresses, no login in the URL, and no `localhost`, `.local`, `.internal`, `.lan`, `.home` or `.arpa` names.

**Track-record files have size limits:** at most 50 circles and 100 receipts per circle, a name of 80 characters, a currency of 8, and a positive contribution. A larger file is refused before any receipt is checked.

## 2026-11-18 · Track records

**A member's track record is one file, signed with their key (kind 3575), that anyone can check without Rota.** It holds the member's original receipt events, exactly as they published them, and for each circle the NIP-44 conversation key between the member and the circle. That key opens this member's messages to the circle and no one else's, because every member's key is different. So a reader checks the member's signature from the day they paid, opens each receipt, and runs the four checks in their own browser. Nothing is uploaded, and no relay or circle secret is needed. The code is `track-record.ts` in `@rota/records` and the `/track-record` page.

**It holds every circle on the device, and only payments that counted.** The export works each round out the way the round screen does, with disputes settled by the recipient, so a payment the recipient settled for someone else stays out. A payment listed twice in a file counts once.

**The file shows the recipients' addresses, M-Pesa numbers included.** A new, address-free summary was the other option, but bitcoin.co.ke's invoices name the number in their signed description, so it can't be hidden without dropping the invoice, and without the invoice a receipt proves almost nothing. The export page says this before the member downloads. The verify page masks phone numbers on screen.

**The reader is told what is proven and what is only stated.** Proven by the receipts: the payment, the address, the sats, when the recipient's service issued the invoice, and who published it. Stated by the member: the circle's name and contribution, each round's deadline (so "on time" compares the service-signed invoice time with a deadline the member gives), and the node each recipient's invoices come from (used for the issuer check, as there's no circle record to compare with). A reader who wants more can fetch a fresh invoice from the address and compare the node; Rota doesn't do that for them yet.

**Known gap:** a member can leave out rounds they didn't pay. The file shows what they did pay, not what they skipped.

## 2026-11-18 · The recipient settles a copied payment

**The round's recipient settles disputes with a signed "received" record, kind 3574.** Every member can decrypt every receipt, so a member can copy another's invoice and preimage into a receipt of their own, and it passes all four checks. Both claimants then show as disputed. The recipient's record says which member each disputed payment came from. It is signed with the recipient's member key and encrypted for the circle like a receipt; the public tags are only the circle and the round. Each phone takes the recipient from the circle's own record, never from the event, and ignores a record signed by anyone else. The code is `received.ts` in `@rota/records`; the recipient sees a "Settle" form on the round screen.

**It settles disputes and nothing else.** A payment only one member claims is already proven by its receipt, so the recipient can't mark it unpaid: a dishonest recipient could otherwise deny a payment they received. A record naming someone who doesn't claim the payment changes nothing. The member it isn't settled for shows as "not counted" and can still pay the round for real.

**The latest record counts.** The recipient republishes the whole list each time, so a wrong pick can be corrected. Only the recipient's key can sign one, so no one else can override it.

**What the recipient decides on is their own knowledge, not proof.** An M-Pesa recipient sees an SMS, not a payment hash, so in practice they pick the member who really sent it (from the group chat, or from who asked). The record makes their word visible and signed; it doesn't make it true. Binding the payer into the invoice itself would make a copied receipt fail outright:

- **bitcoin.co.ke offers neither LNURL comments (LUD-12) nor payer data (LUD-18)** (checked 2026-11-18 with a dummy number: no `commentAllowed`, no `payerData`). So for M-Pesa recipients, Rota's main case, the recipient's record is the only way to settle a dispute.
- **Alby offers both** (checked 2026-11-18 on Alby's own public address: `commentAllowed` 255, `payerData` with an optional `pubkey`). LUD-18 puts payer data in the description hash, so a payer's Nostr key there would be signed into the invoice. Not built, and not checked that Alby's invoices actually hash it.

## 2026-11-15 · Rounds, paying and Verify

**The round screen is worked out on each member's phone.** Once every seat is taken, `/circle` shows the round open now (and earlier rounds), its recipient, and each payer as paid, pending, late or disputed. It reads the round's receipts from the relay and checks every one on the phone. A member counts as paid only with a receipt that passes all checks and a payment no other member also claims. The code is `roundView` in `@rota/records`.

**Amounts are judged against a band around today's price, ±20%.** Sats are worked out on each payer's phone when they pay, so the exact figure differs between members and between days, and no member can know in advance what another should have paid. A receipt passes the amount check when it does three things. It claims exactly the circle's contribution in local money. Its invoice is for exactly the sats it records. Those sats are within ±20% of what the contribution costs at the checking phone's current price. A large underpayment fails. A small one inside the band doesn't, which is a known gap. In a monthly circle, an old receipt can fall outside the band after a large price move; the band would then need the price at the round's date, which Rota doesn't fetch yet. With no price available, every amount check fails, so nothing counts as paid by mistake.

**Paying runs entirely on the payer's phone.** The steps are: fetch the recipient's pay parameters, work out the sats (Tando's own rate for M-Pesa, today's price otherwise), refuse if that amount falls outside the band other members will apply, fetch the invoice and check it, then pay it with the built-in wallet or the NWC connection, unlocked with the PIN for this payment only. After that, the phone signs the receipt and publishes it. The receipt is saved on the phone before publishing, and the phone keeps retrying until the relay accepts it, so a paid round is never lost to a dropped connection. Paying waits until the organizer's roster fixes the seats.

**Verify shows each check on each receipt.** The four receipt checks and the member signature, each with its reason, all worked out on the phone from the circle's own record. A receipt for an M-Pesa recipient says its address proof is the weaker one, because bitcoin.co.ke signs a plain description, not a hash.

**Not built:** the recipient's signed "received" record that would settle a disputed payment.

## 2026-11-15 · Circles on the relay, no backend

**A circle lives on its relay, not on a Rota server.** There are three event kinds, all regular and all encrypted for the circle with NIP-44:
- the organizer's circle definition (kind 3571);
- each member's join (kind 3572): name, payout address and the node that signed a test invoice for it;
- the organizer's roster (kind 3573).

Rota needs no database, `docker compose up` stays app + relay, and no Rota server ever sees names or phone numbers.

**The invite link is `/circle#<circle secret>.<definition id>`.** Browsers don't send the part after `#` to any server. The definition's id pins the exact definition the organizer signed, so someone else holding the link can't publish a rival one. Anyone with the link can read the circle and take a free seat, which the page says next to the link.

**Seats fill in join order, then the organizer's device fixes them.** Joins are taken in time order (earliest join per member, one seat per payout address, M-Pesa only in KES circles). Event times are set by whoever signs, so a late joiner could backdate their join and push someone out, even after the circle is full. The tests show this. Once every seat is taken, the organizer's device publishes a signed roster, and from then on the order can't change. A roster counts only if the organizer signed it and everyone on it has joined.

**Each member's payout address is checked on their own phone when they join.** It fetches the address's pay parameters and an unpaid invoice, and records the node that signed it for receipt check 3. Nothing is paid.

**The member's Nostr key is kept in plain browser storage.** It signs joins and receipts but can't move money. Someone with access to the device could sign as that member, but a fake receipt still fails the paid check. Keeping it sealed with the PIN would mean a PIN prompt at every publish.

**M-Pesa numbers are shown masked** (2547•••••678@bitcoin.co.ke) on the circle page.

## 2026-11-15 · Receipts on the relay

**One Nostr event per payment, kind 3570, through `nostr-tools` 2.25.4.** A regular event, not a replaceable one, so nobody can overwrite a receipt later. 3570 isn't in the NIPs registry (checked 2026-11-15). nostr-tools is pinned to a release more than two weeks old; `@getalby/sdk` brings its own newer copy for NWC.

**Signed by the paying member, encrypted for the circle.** Each circle has its own key pair, and its secret travels in the invite link. The member encrypts with NIP-44 using their own key and the circle's public key, so anyone holding the invite link can decrypt and nobody else can. The relay sees only the member's public key, the circle's public key, the round number and ciphertext. The address, invoice, preimage and amounts are all encrypted.

**The phone refuses to publish a receipt that fails the four checks.** The checks run right after paying, before signing.

**When checking a receipt, the recipient, their nodes and the contribution come from the circle's own record, not from the event.** (How the sats are judged: see "Rounds, paying and Verify".) So a member can't vouch for their own receipt. The member's signature must verify and the key must be on the circle's member list. That is the "by this member" half of check 4. Events are rebuilt from their signed fields before checking, because nostr-tools caches a "verified" flag on the event object that would otherwise survive a later change.

**One payment counts once.** Every member can decrypt every receipt, so a member could copy someone else's invoice and preimage into a receipt of their own, and it would pass all four checks. When two members claim the same payment hash, both are shown as disputed until the recipient's signed "received" record settles it (see 2026-11-18). Binding the payer into the invoice itself, for example with an LNURL comment, would stop this at the source; whether bitcoin.co.ke accepts comments is not checked.

**Tested** with generated invoices (19 unit tests) and once against the local strfry relay: publish, read back by circle and round, decrypt and verify. That relay test runs only when `ROTA_TEST_RELAY` is set, so CI skips it. No real payment has gone through it yet.

## 2026-11-15 · The wallets: built-in and your own

**Built-in wallet: Breez SDK (Spark) 0.28.4, in the browser.** The SDK runs as WebAssembly on the member's phone and keeps its state in the browser's IndexedDB, so the keys never leave the device. It loads from the SDK's browser entry and only on the client (`init()` before anything else). Its Node storage (better-sqlite3) is skipped at install because the browser never uses it.

**The Breez API key ships to the browser.** The SDK needs it on mainnet (not on regtest) and runs in the browser, so the key is a `NEXT_PUBLIC_` variable and anyone can read it from the page. It identifies the app to Breez; it can't move anyone's money. Breez's key is a certificate that embeds the email address it was requested with, so that address is public too. One key serves both development and the hosted demo (decided 2026-11-15). Anyone running their own copy should request their own key.

**Recovery words and wallet connections are encrypted with a PIN on the device.** PBKDF2-HMAC-SHA256 at 600,000 iterations (OWASP's 2023 figure; stored in each blob so it can change), then AES-256-GCM with a fresh salt and nonce each time. A wrong PIN and a changed blob both fail the same way. Minimum 6 characters. Limit, in the threat model: someone who copies the blob can guess PINs offline, so a longer passphrase is stronger.

**Every built-in payment is checked twice.** Before sending, the SDK's quote must be for the same invoice and the exact amount Rota approved, with a fee of at most 1% (10 sats minimum). After sending, the payment must be complete and its preimage must hash to the invoice's payment hash. The SDK is told not to pay over Spark (`preferSpark: false`), because a Spark transfer returns no preimage and so no receipt.

**Each payment's idempotency key comes from its payment hash,** so tapping Pay twice can't pay twice. The SDK refused the raw hash as a key ("invalid idempotency key") and doesn't document the format; a UUID-shaped key made from the hash's first 16 bytes (version and variant bits set) works.

**Compose builds the app on regtest by default,** so `docker compose up` needs no API key and can't spend real money. Regtest has no Lightning, so only wallet creation, backup, locking and unlocking can be tried there. Mainnet is chosen in `.env`.

**Your own wallet: Nostr Wallet Connect (NIP-47) through `@getalby/sdk` 9.0.0.** Rota asks for a connection that can do three things only (`pay_invoice`, `get_info`, `get_budget`), with a monthly budget of one contribution plus 25% (room for fees and price moves) that expires at the end of the cycle. The wallet enforces the budget; Rota can't raise it.

**Rota refuses a connection wider than it asked for.** Before saving, it reads the connection's methods and budget and refuses any extra method, no way to pay, no budget, a budget that doesn't renew monthly, or one above the cap. It also refuses a budget below one contribution: NIP-47 reports budgets in millisats, and if a wallet reported sats instead, this makes the check fail closed.

**Other ways to pay are accepted alongside `pay_invoice` (changed 2026-11-15).** Alby Hub has one "Send payments" permission that grants `pay_invoice`, `pay_keysend`, `multi_pay_invoice` and `multi_pay_keysend` together, with no narrower choice, so the first real connection (desktop Hub 1.24.6) was refused. Its source (`nip47/permissions/permissions.go`; `transactions/transactions_service.go`, where `validateCanPay` runs before both invoice and keysend payments) shows that the same monthly budget, plus a fee reserve, caps all four. Paying an invoice can already send money anywhere, so the extra three add no power, only other routes under the same cap. Rota accepts them and never calls them; everything else (balance, invoices, history, signing, notifications) is still refused.

**Two ways to connect.** Alby Hub in a browser: Rota opens the Hub's approval page with the limits filled in, and the member approves them there. **The Alby Hub desktop app has no such page:** `my.albyhub.com/apps/new` opened the Alby Account dashboard instead (2026-11-15). So the desktop app, like any other NWC wallet, uses the paste route: the member creates the connection in the Hub (Connections → Add connection → Custom, only "Read your node info" and "Send payments", isolation off, monthly budget, expiry on) and pastes it. Either way the connection string is kept on the device, encrypted with the PIN like the recovery words, and never reaches Rota's server. After an NWC payment Rota checks the returned preimage against the invoice, as for the built-in wallet.

**Checked with a real wallet (desktop Alby Hub, 2026-11-15):** the Hub lists only the methods it granted (the four payment methods plus `get_info` and `get_budget`). **Not yet checked:** that it reports budgets in millisats, and a payment through a capped connection.

## 2026-11-14 · Circles, amounts and paying an address

The circle model, price conversion and invoice checks live in `packages/circles` (`@rota/circles`), pure TypeScript that the web app, a seed script or a server can share. `lightning-receipts` (`packages/receipts`) stays small, because it's meant to be published on its own.

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

**Relay: strfry, pinned by digest.** `ghcr.io/hoytech/strfry` (version 1.1.2-148, arm64 digest `sha256:1b2a6fe1…87bb`). Its default config binds to 127.0.0.1 inside the container, so Rota mounts a config with `bind = "0.0.0.0"` and publishes the port on the host's localhost only. One NIP-44 encrypted event (kind 30078, throwaway keys, fake content) was published, read back by id, its signature verified and its content decrypted to the original. NIP-44 is done in the app; the relay only stores ciphertext. *Superseded the same day by the Docker Compose entry above: Compose pins the multi-arch index digest instead of the arm64 one and passes `--set relay.bind=0.0.0.0` instead of mounting a config file.*

## 2026-11-14 · Project setup

**Layout: a pnpm workspace.** `apps/web` is the Next.js PWA; `packages/receipts` is the receipt checker. The checker is meant to ship as its own MIT package that any Lightning app can use, so it lives in its own folder with its own tests from the first commit. Until it is published it is marked `private` and exports its TypeScript source; the web app consumes it through the workspace.

**Package name: `@rota/receipts`,** if the `rota` scope can be registered on npm before publishing. If not, it gets an unscoped name. *Superseded 18 Nov: published as `lightning-receipts` (see "The receipt checker on npm").*

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
| Built-in wallet in the browser | Runs on regtest: create, back up, lock and unlock (regtest has no Lightning, so no payment yet) | Breez SDK in the browser; key in a public env variable |
| NWC pay-only with a cap | Built and refusals tested in the browser; not yet run against a real wallet | Ask for pay-only with a monthly budget; refuse anything wider |
| M-Pesa payout through `number@bitcoin.co.ke` | Not run | — |
| Address in the invoice (description hash), bitcoin.co.ke | No hash; the signed description names the address | Check 2 reads the description for this service |
| Address in the invoice, one other Lightning address | Not run (waits for a wallet) | — |
| Browser fetch of LNURL (CORS), bitcoin.co.ke | Pass (`Access-Control-Allow-Origin: *` on metadata and callback) | Fetch in the browser; no proxy |
| LUD-21 verify URL, bitcoin.co.ke | Not offered | Tando's status API as a convenience only |
| Prices (BTC/EUR, BTC/KES) | Pass (CoinGecko; Coinbase within 0.1%) | CoinGecko, Coinbase fallback, XOF = EUR × 655.957 |
| Relay (strfry, NIP-44) | Pass | strfry pinned by digest, bound to localhost |
