# Rota
A tontine (or chama) where nobody holds the pot. Each round, every member pays that round's recipient directly over Lightning, and every payment leaves a proof anyone in the group can check.

> Under construction for the Dakar Bitcoin Hack.

## Run it

Requires Docker with Compose.

```bash
docker compose up --build
```

This starts the web app on http://localhost:3000 and a local Nostr relay (strfry) on ws://localhost:7777. Both listen on this machine only. Stop with `docker compose down`; relay data is kept in a Docker volume (`docker compose down -v` removes it).

It also seeds a fictional demo circle: five members, round 3 of 5, with rounds 1 and 2 paid and every receipt checkable. To get its links:

```bash
docker compose logs seed
```

Open a member's demo login link to act as that member in your browser (Baraka and Fatou still owe round 3). The demo keys are public and the seeded payments never moved money, so the seed runs on regtest only.

## Development

Requires Node 24 and pnpm 10.

```bash
pnpm install
pnpm dev        # the web app on http://localhost:3000
pnpm test       # all tests
pnpm typecheck
pnpm lint
pnpm build
```

| Folder | What it is |
|---|---|
| `apps/web` | The Next.js PWA |
| `packages/receipts` | The receipt checker: proves a Lightning payment reached a specific address |
| `packages/records` | The circle on Nostr: its definition, joins and roster (kinds 3571–3573) and one signed receipt per payment (kind 3570), all NIP-44 encrypted on the circle's relay |
| `scripts/seed` | The demo seed: publishes the fictional circle and prints its links (`pnpm --filter @rota/seed start` with the relay running) |

The relay test in `packages/records` runs only against a local relay: start it with `docker compose up -d relay`, then run `ROTA_TEST_RELAY=ws://127.0.0.1:7777 pnpm --filter @rota/records test`.

Decisions and their reasons are in [DECISIONS.md](DECISIONS.md). What Rota protects against, and what it doesn't yet, is in [THREAT_MODEL.md](THREAT_MODEL.md).

## License

[MIT](LICENSE)
