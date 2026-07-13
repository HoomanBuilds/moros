import type { ReactNode } from "react";
import { Navbar } from "@/components/app/navbar";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto max-w-[1500px] px-6 py-8 lg:px-10">{children}</main>
    </div>
  );
}
