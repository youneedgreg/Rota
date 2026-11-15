// Shared class names and messages for the app's forms.
export const button = "min-h-12 rounded-lg bg-foreground px-4 font-medium text-background disabled:opacity-50";
export const secondary = "min-h-12 rounded-lg border border-current px-4 font-medium disabled:opacity-50";
export const input = "min-h-12 w-full rounded-lg border border-current/30 bg-transparent px-3";
export const field = "block space-y-2";

export function explain(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again.";
}

/** Shows a payout address without the middle of a phone number: 2547•••••678@bitcoin.co.ke. */
export function maskAddress(address: string): string {
  const [user, domain] = address.split("@");
  if (!user || !domain || !/^\d{9,}$/.test(user)) return address;
  return `${user.slice(0, 4)}${"•".repeat(user.length - 7)}${user.slice(-3)}@${domain}`;
}
