import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { productUrls } from "@/lib/product-urls";
import "lenis/dist/lenis.css";
import "./globals.css";

const sans = Instrument_Sans({ variable: "--font-sans", subsets: ["latin"] });
const display = Instrument_Serif({ variable: "--font-display", subsets: ["latin"], weight: "400" });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });
const themeScript = `try{var m=localStorage.getItem("moros-pay-theme");var d=m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";document.documentElement.style.colorScheme=d?"dark":"light"}catch{}`;

export const metadata: Metadata = {
  metadataBase: new URL(productUrls.pay),
  title: { default: "Moros Pay", template: "%s | Moros Pay" },
  description: "Private USDC payments on Stellar.",
  applicationName: "Moros Pay",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Moros Pay - Private USDC payments on Stellar",
    description: "Send, receive, request, and reuse private Circle USDC on Stellar.",
    url: "/",
    siteName: "Moros Pay",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Moros Pay - Private USDC payments on Stellar",
    description: "Send, receive, request, and reuse private Circle USDC on Stellar.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f0eb" },
    { media: "(prefers-color-scheme: dark)", color: "#070709" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
