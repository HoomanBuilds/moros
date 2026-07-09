"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { getKit, truncate } from "@/lib/wallet";

export function ConnectButton() {
  const [address, setAddress] = useState("");

  useEffect(() => {
    getKit()
      .getAddress()
      .then((r) => setAddress(r.address))
      .catch(() => {});
  }, []);

  async function connect() {
    const kit = getKit();
    const { address } = await kit.authModal();
    setAddress(address);
  }

  return (
    <Button variant="outline" onClick={connect} className="font-mono text-xs">
      {address ? truncate(address) : "Connect wallet"}
    </Button>
  );
}
