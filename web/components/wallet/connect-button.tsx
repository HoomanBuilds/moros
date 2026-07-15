"use client";

import { useState } from "react";
import { Copy, Check, RefreshCw, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { truncate } from "@/lib/wallet";
import { useWalletAddress, connectWallet, disconnectWallet } from "@/lib/wallet-store";

export function ConnectButton() {
  const address = useWalletAddress();
  const [copied, setCopied] = useState(false);

  async function connect() {
    try {
      await connectWallet();
    } catch {
      return;
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      return;
    }
  }

  if (!address) {
    return (
      <Button variant="outline" onClick={connect} className="font-mono text-xs">
        Connect wallet
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 font-mono text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-[#16c784]" />
          {truncate(address)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Connected wallet
        </DropdownMenuLabel>
        <DropdownMenuItem
          className="gap-2"
          onSelect={(e) => {
            e.preventDefault();
            copy();
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy address"}
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onSelect={() => connect()}>
          <RefreshCw className="h-3.5 w-3.5" />
          Change wallet
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-[#f0564a] focus:text-[#f0564a]"
          onSelect={() => disconnectWallet()}
        >
          <LogOut className="h-3.5 w-3.5" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
