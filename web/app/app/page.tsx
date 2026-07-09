import Link from "next/link";

export default function AppPlaceholder() {
  return (
    <main className="relative min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Stellar testnet - unaudited</p>
        <h1 className="font-display text-5xl md:text-6xl mt-4">The app is coming</h1>
        <p className="text-muted-foreground mt-4">
          Private markets, encrypted orders, and in-browser proving are being wired up. The landing is live;
          the trading terminal lands next.
        </p>
        <Link href="/" className="inline-block mt-8 font-mono text-xs underline underline-offset-4">
          back to home
        </Link>
      </div>
    </main>
  );
}
