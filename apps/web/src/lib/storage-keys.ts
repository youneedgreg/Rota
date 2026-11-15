// Where each wallet keeps its sealed secret on this device. In their own file so
// pages can tell which wallets exist without loading the wallet SDKs.
export const BUILT_IN_WALLET_KEY = "rota.wallet.v1";
export const NWC_KEY = "rota.nwc.v1";

/** Which wallets this device has saved (sealed with the member's PIN). */
export function walletsOnDevice(): { builtIn: boolean; nwc: boolean } {
  try {
    return { builtIn: localStorage.getItem(BUILT_IN_WALLET_KEY) !== null, nwc: localStorage.getItem(NWC_KEY) !== null };
  } catch {
    return { builtIn: false, nwc: false };
  }
}
