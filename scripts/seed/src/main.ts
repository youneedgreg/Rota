// Seeds the local demo circle on the relay and prints its links.
//   pnpm --filter @rota/seed start         (with the relay running)
// Runs once in `docker compose up` too (the "seed" service). If the relay
// already holds the demo circle, nothing is published again.
import { createPriceSource } from "@rota/circles";
import { CIRCLE_KIND, encodeInvite, fetchCircle, publishEvent } from "@rota/records";
import { hexToBytes } from "@noble/hashes/utils.js";
import { buildDemo, demoLoginFragment, type Demo } from "./demo";

const relayUrl = process.env.RELAY_URL || "ws://localhost:7777";
const webUrl = (process.env.WEB_URL || "http://localhost:3000").replace(/\/$/, "");
const network = process.env.NEXT_PUBLIC_BREEZ_NETWORK || "regtest";

function print(demo: Pick<Demo, "invite" | "logins">, fresh: boolean): void {
  const lines = [
    "",
    fresh ? "Rota demo circle seeded." : "Rota demo circle already on the relay; nothing published.",
    "Five fictional members, round 3 of 5. Demo keys are public: never use them for real money.",
    "",
    `Circle (view only): ${webUrl}/circle#${demo.invite}`,
    "",
    "Demo logins (open one to act as that member in this browser):",
    ...demo.logins.map(
      (l) => `  ${l.name.padEnd(8)} ${webUrl}/demo#${demoLoginFragment(l.secret, demo.invite)}${l.owesCurrentRound ? "   (owes round 3)" : ""}`,
    ),
    "",
  ];
  console.log(lines.join("\n"));
}

/** The relay may still be starting when Compose starts the seed: try for about 30 seconds. */
async function withRetries<T>(task: () => Promise<T>, attempts = 15): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await task();
    } catch (error) {
      if (i >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function main(): Promise<void> {
  if (network !== "regtest") {
    // The demo's receipts are signed with public keys and no money moved: never put them next to real circles.
    throw new Error("The demo seed runs on regtest only (NEXT_PUBLIC_BREEZ_NETWORK=regtest).");
  }
  const quote = await createPriceSource({ fetch }).getQuote();
  const demo = buildDemo({ quote, now: new Date(), network: "bcrt" });

  // Seeded before (any day)? Then keep that circle, so its links keep working.
  const existing = (await withRetries(() => fetchCircle(relayUrl, demo.circlePubkey))).filter((e) => e.kind === CIRCLE_KIND);
  const earlier = existing.find((e) => e.pubkey === demo.organizerPubkey);
  if (earlier) {
    print({ ...demo, invite: encodeInvite(hexToBytes(demo.circleSecret), earlier.id) }, false);
    return;
  }

  for (const event of demo.events) await publishEvent(relayUrl, event);
  print(demo, true);
}

main().catch((error: unknown) => {
  console.error(`Seeding failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
