import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { NETWORK } from "@/lib/network";

let initialized = false;
let walletKit = StellarWalletsKit;

export function getKit(): typeof StellarWalletsKit {
  if (!initialized) {
    walletKit.init({
      network: NETWORK.id === "mainnet" ? Networks.PUBLIC : Networks.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: defaultModules(),
    });
    initialized = true;
  }
  return walletKit;
}

export function configureWalletKitAdapter(
  adapter: typeof StellarWalletsKit,
): void {
  walletKit = adapter;
  initialized = true;
}

export function truncate(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
}
