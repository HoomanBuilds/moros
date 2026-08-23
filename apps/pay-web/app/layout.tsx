import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { PaymentWalletProvider } from "@/components/wallet-provider";
import { StellarWalletProvider } from "@/components/stellar-wallet-provider";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const sans = Instrument_Sans({ variable: "--font-sans", subsets: ["latin"] });
const display = Instrument_Serif({ variable: "--font-display", subsets: ["latin"], weight: "400" });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Moros Pay", template: "%s | Moros Pay" },
  description: "Private USDC payments on Stellar.",
  applicationName: "Moros Pay",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#050505",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <body><ThemeProvider><PaymentWalletProvider><StellarWalletProvider>{children}</StellarWalletProvider></PaymentWalletProvider></ThemeProvider></body>
    </html>
  );
}
