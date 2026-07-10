import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";

let initialized = false;

export function getKit(): typeof StellarWalletsKit {
  if (!initialized) {
    StellarWalletsKit.init({
      network: Networks.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: defaultModules(),
    });
    initialized = true;
  }
  return StellarWalletsKit;
}

export function truncate(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
}
