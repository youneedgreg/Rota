# Threat model

What Rota protects, who it doesn't trust, and what's still open. Written 2026-11-18, against the code in this repository. Every claim names the code that makes it true; anything not built yet is marked as such.

## The claim, precisely

**Rota never holds members' money.** Each member's phone pays the round's recipient directly over Lightning. There is no pot, no treasurer and no Rota account that money passes through.

**With an outside wallet connected over NWC, a fully compromised Rota can spend at most about 1.25 contributions a month per member, and only until the connection expires at the cycle's end.** The cap is the wallet's budget, not Rota's code: the wallet refuses to pay past it whatever Rota sends. Rota refuses to save a connection that grants more than paying, or that has no monthly budget, or a budget above the cap (`packages/wallet/src/nwc.ts`, `checkConnection`).

**With the built-in wallet, the cap doesn't hold against a compromised web host.** Its recovery words are sealed with the member's PIN and never leave the phone (`packages/wallet/src/vault.ts`). But the page that asks for the PIN is served by whoever hosts Rota. If that host served altered code, it could read the wallet the next time the member unlocks it and take its whole balance. Mitigation: keep about one contribution in the built-in wallet, or use an NWC wallet. The pitch line "Rota can pay one contribution a month on your behalf, and nothing else" is true for NWC connections only.

**No one can rewrite who paid.** Every receipt is signed by the paying member's own key and carries the invoice and its preimage, which only a real payment reveals (`packages/records/src/records.ts`). Rota's host and the relay can hide receipts but can't forge or change one.

## What runs where

| Part | Holds | Trusted for |
|---|---|---|
| Member's phone (the Rota web app) | Member's Nostr key, saved invite links, the built-in wallet sealed with the PIN, NWC connection sealed with the PIN | Everything: every check runs here |
| Rota's web host | The app's code, nothing else: no database, no accounts, no API routes | Serving honest code (see above) |
| Relay (strfry) | Signed, NIP-44-encrypted events | Nothing; it can drop events but not read or forge them |
| Recipient's Lightning service (e.g. bitcoin.co.ke via Tando, Alby) | The recipient's address and node | Issuing invoices for that address; the payer's phone checks them |
| Price APIs (CoinGecko, Coinbase fallback) | Nothing about members | A price within a sanity band; never decides who paid |
| Member's NWC wallet | The member's funds and the budget | Enforcing the cap |
| Breez SDK (Spark) | The built-in wallet's node, in the browser | Paying an invoice it was handed, with the amount and fee Rota checked first |

## Threats and defences

| Threat | What could happen | Defence in Rota | Where |
|---|---|---|---|
| Treasurer theft | The person holding the pot disappears | There is no pot; each member pays the recipient directly | `apps/web/src/lib/rounds.ts`, `payRound` |
| Rota compromised, NWC wallet | Attacker drains members' wallets | Pay-only connection, monthly budget of contribution + 25%, expiry at cycle end, enforced by the wallet; wider connections refused | `packages/wallet/src/nwc.ts` |
| Rota compromised, built-in wallet | Altered code reads the wallet when the PIN is typed | **Not prevented.** Keep little in it; the CSP stops other sites' scripts, not a compromised host | `THREAT_MODEL.md` (this file), `next.config.ts` |
| Fake "I paid" | A member claims a payment they didn't make | Four receipt checks on every phone: preimage, recipient's address, issuing node, amount | `packages/receipts` |
| Copied payment | A member copies another's invoice and preimage (every member can decrypt every receipt) | One payment counts once; both claimants are "disputed" until the round's recipient signs who it came from | `roundClaims`, `packages/records/src/received.ts` |
| Forged records | Someone posts a receipt, join or roster in another's name | Every event is signed by its author's key and checked on every phone; recipient, nodes and amount come from the circle's record, never from the event | `verifyReceiptEvent`, `assembleCircle` |
| Swapped recipient | An attacker substitutes their own invoice | The payer's phone fetches the invoice from the recipient's address and checks the address, the node recorded at join, the amount and the network; Rota never supplies an invoice | `packages/circles/src/lnurl.ts` |
| Late joiner pushes someone out | A joiner backdates their join to take an earlier seat | The organizer's phone publishes a roster once the circle is full; after that the order is fixed | `createRosterEvent` |
| Leaked invite link | Anyone with the link can read the circle's history and join an open seat | The secret sits after `#`, which browsers never send to a server; error reports strip it. **Key rotation is not built.** | `encodeInvite`, `apps/web/src/lib/telemetry.ts` |
| Relay reads the circle | Amounts, names, addresses exposed | All content NIP-44 encrypted for the circle. The relay still sees who posts, when, the circle's public key and round numbers | `packages/records` |
| Relay flooded | Junk events tagged with a circle push real ones past the 500-event read limit | **Not handled.** Junk fails its checks but can crowd out real receipts. A write-restricted relay would fix it | `packages/records/src/relay.ts` |
| Personal data in error reports | Phone numbers, addresses, invoices or invite secrets sent to Sentry | Off unless a DSN is set; URL `#` parts and queries removed, breadcrumbs dropped, phone numbers, Lightning addresses, invoices and keys blanked before sending; no replay, no IP | `apps/web/src/lib/telemetry.ts` |
| Track record over-shares | The file reveals recipients' addresses | The member is warned before exporting; the verify page masks phone numbers. The file is shared only by the member | `/track-record` |
| Track record padded | A member lists a payment twice or someone else's | Counted once; receipts not signed by the file's member fail | `verifyTrackRecord` |
| Bad input | Malformed invoices, amounts, addresses, URLs | Every invoice, amount and address is validated before any payment; amounts outside the round's band are refused; LNURL URLs must be HTTPS to a public host name, with no redirects | `packages/circles`, `packages/wallet/src/guard.ts` |
| Script injection | Another site's script runs inside Rota | React escapes all text; the Content-Security-Policy allows scripts only from Rota itself, and the page can't be framed | `apps/web/next.config.ts` |
| Member defaults after payout | Takes their round, then stops paying | Can't be prevented without custody. Rota makes it visible; track records let a new circle see who pays on time | `/track-record` |
| AI misuse | Prompt injection makes an AI move money | No AI feature is built. If one is added, it reads the round summary only and has no wallet access | — |

## Secrets

- **Members' secrets never leave the phone:** recovery words and NWC connections are sealed with the member's PIN (PBKDF2, 600,000 rounds, AES-GCM). The member's Nostr key is kept in plain browser storage; it can sign but can't move money, and a forged receipt still fails the paid check.
- **The Breez API key ships in the browser bundle.** Anyone can read it. It identifies the app to Breez and can't move money.
- **The repository holds no real keys.** `.env.example` has fake values; real ones go in a local `.env.local`, which git ignores.

## Personal data

- Rota has no server-side storage, accounts or logs of its own.
- Phone numbers appear in payout addresses, which are encrypted for the circle on the relay and masked on screen.
- Error reports, when turned on, are scrubbed on the phone before sending (see the table above). Turn on Sentry's server-side data scrubbing as a second layer.

## Known gaps, in order of risk

1. **A compromised web host can empty the built-in wallet** once the member types their PIN. Keep little in it.
2. **No key rotation** for a leaked invite link.
3. **The relay is open to writes,** so it can be flooded.
4. **The recipient's settlement is their word, not proof.** It only chooses between members who both claim the same payment.
5. **A track record shows what a member paid, not what they skipped.**
