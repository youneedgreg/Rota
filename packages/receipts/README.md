# lightning-receipts

Check that a Lightning payment reached a specific Lightning address, using only three things the payer already has: the BOLT11 invoice, the preimage their wallet returned, and the LNURL-pay metadata the address served. It makes no network calls and trusts no server.

It was built for [Rota](https://github.com/youneedgreg/Rota), a savings circle where members pay each other directly, so anyone in the group can check a payment without asking the person who was paid. It works for any app that needs a receipt someone else can check.

It isn't on npm yet. To use it in another project, build and pack it from this repo, then install the packed file:

```bash
git clone https://github.com/youneedgreg/Rota.git && cd Rota
pnpm install
pnpm --filter lightning-receipts build
cd packages/receipts && pnpm pack
```

```bash
npm install /path/to/Rota/packages/receipts/lightning-receipts-0.1.0.tgz
```

ESM only. Runs in browsers and in Node 20.19 or later. Its only dependencies are `@noble/curves`, `@noble/hashes` and `@scure/base`.

## The four checks

| Check | Passes when |
|---|---|
| `paid` | SHA-256 of the preimage equals the invoice's payment hash |
| `address` | The invoice commits to SHA-256 of the address's metadata (LUD-06 description hash), and that metadata names the address (LUD-16). A weaker fallback also passes when the signed plain description names the address (see below). |
| `issuer` | The invoice's signature recovers a node key you recorded for this address earlier |
| `amount` | The invoice is on the expected network and for exactly the expected amount |

The invoice's signature is always verified. Every check runs even when an earlier one fails, so you can show the whole result.

## Use

```ts
import { verifyReceipt } from "lightning-receipts";

const result = verifyReceipt({
  invoice: "lnbc...",               // the invoice that was paid
  preimage: "9f2c...",              // hex, from the payer's wallet
  address: "alice@example.com",     // where the money was meant to go
  metadata: '[["text/plain","..."],["text/identifier","alice@example.com"]]', // exactly as the address served it
  knownNodeKeys: ["03ab..."],       // node keys seen for this address earlier
  expectedAmountMsat: 12_180_000n,
  network: "bc",                    // "bc" mainnet (default), "tb" testnet, "bcrt" regtest
});

result.ok;     // true only if all four checks pass
result.checks; // [{ check: "paid", ok: true, detail: "..." }, ...]
```

On a passing `address` check, `proof` says how the invoice was tied to the address: `"description-hash"` (strong) or `"description"` (weaker).

The library also exports `decodeInvoice` (a BOLT11 decoder that verifies the signature and recovers or checks the payee key), each check on its own (`checkPaid`, `checkAddress`, `checkIssuer`, `checkAmount`), `metadataIdentifier`, `InvoiceError` and the `RECEIPT_CHECKS` list. Types are included.

### Where `knownNodeKeys` comes from

Fetch an unpaid invoice from the address when the relationship starts (for example, when a member joins a group), decode it, and keep `payeeNodeKey`. Later receipts must come from that node. If the address's service changes nodes, record the new key the same way.

## What a passing receipt proves, and what it doesn't

- **It proves** that whoever has the preimage paid an invoice that the address's own service signed, for that address, for that amount.
- **It doesn't prove who paid.** A preimage can be copied. Anyone who sees a receipt can present the same invoice and preimage as their own. Tie each receipt to a payer some other way: Rota has each member sign their receipt, and the recipient settles any payment two members both claim.
- **The `"description"` proof is weaker.** Some services (for example bitcoin.co.ke on 14 Nov 2026) sign a plain description such as "Payment to alice@…" and no description hash. Then the invoice names the address, but nothing ties it to the exact metadata. The `issuer` check carries more of the weight in that case.
- **The metadata and node keys are yours to get right.** The library checks against what you pass it. Fetch the metadata on the payer's own device, and record node keys before any money moves.

## License

[MIT](LICENSE) · Made by Gregory Temwa Odete
