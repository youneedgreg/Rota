# Rota
A tontine (or chama) where nobody holds the pot. Each round, every member pays that round's recipient directly over Lightning, and every payment leaves a proof anyone in the group can check.

> Under construction for the Dakar Bitcoin Hack.

## Run it

Requires Docker with Compose.

```bash
docker compose up --build
```

This starts the web app on http://localhost:3000 and a local Nostr relay (strfry) on ws://localhost:7777. Both listen on this machine only. Stop with `docker compose down`; relay data is kept in a Docker volume (`docker compose down -v` removes it).

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

The relay test in `packages/records` runs only against a local relay: start it with `docker compose up -d relay`, then run `ROTA_TEST_RELAY=ws://127.0.0.1:7777 pnpm --filter @rota/records test`.

Decisions and their reasons are in [DECISIONS.md](DECISIONS.md).

## License

[MIT](LICENSE)
