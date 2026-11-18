// Shared class names and messages for the app's forms.
export const button =
  "min-h-12 rounded-lg bg-accent px-4 font-semibold text-accent-ink shadow-sm hover:brightness-110 disabled:opacity-50";
export const secondary =
  "min-h-12 rounded-lg border border-line-strong bg-surface px-4 font-medium hover:bg-foreground/5 disabled:opacity-50";
export const input = "min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3";
export const field = "block space-y-2";
/** A section on a screen. */
export const card = "rounded-2xl border border-line bg-surface p-4 shadow-sm";
/** An error the member must read. */
export const alert = "rounded-lg border border-bad/50 bg-bad/10 p-3 text-bad";
/** A small status label: always pair it with an icon and a word. */
export const pill = "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-semibold";

/** Shows a payout address without the middle of a phone number: 2547•••••678@bitcoin.co.ke. */
export function maskAddress(address: string): string {
  const [user, domain] = address.split("@");
  if (!user || !domain || !/^\d{9,}$/.test(user)) return address;
  return `${user.slice(0, 4)}${"•".repeat(user.length - 7)}${user.slice(-3)}@${domain}`;
}
