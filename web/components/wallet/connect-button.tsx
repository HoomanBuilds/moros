"use client";

import { Button } from "@/components/ui/button";
import { truncate } from "@/lib/wallet";
import { useWalletAddress, connectWallet } from "@/lib/wallet-store";

export function ConnectButton() {
  const address = useWalletAddress();

  async function connect() {
    try {
      await connectWallet();
    } catch {
      return;
    }
  }

  return (
    <Button variant="outline" onClick={connect} className="font-mono text-xs">
      {address ? truncate(address) : "Connect wallet"}
    </Button>
  );
}
