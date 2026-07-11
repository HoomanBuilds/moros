import type { ReactNode } from "react";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <Sidebar />
      <div className="lg:pl-64">
        <Topbar />
        <main className="max-w-[1400px] mx-auto px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
