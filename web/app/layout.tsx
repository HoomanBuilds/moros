import React from "react"
import type { Metadata } from 'next'
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Providers } from '@/components/providers'
import './globals.css'

const instrumentSans = Instrument_Sans({ 
  subsets: ["latin"],
  variable: '--font-instrument'
});

const instrumentSerif = Instrument_Serif({ 
  subsets: ["latin"],
  weight: "400",
  variable: '--font-instrument-serif'
});

const jetbrainsMono = JetBrains_Mono({ 
  subsets: ["latin"],
  variable: '--font-jetbrains'
});

export const metadata: Metadata = {
  metadataBase: new URL('https://moros.fun'),
  title: 'Moros - Private prediction markets on Stellar',
  description: 'Create and trade private prediction markets with Circle USDC on Stellar. Encrypted positions, adaptive batch pricing, and proof-bound settlement.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Moros - Private prediction markets on Stellar',
    description: 'Create and trade private prediction markets with Circle USDC on Stellar. Encrypted positions, adaptive batch pricing, and proof-bound settlement.',
    url: '/',
    siteName: 'Moros',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Moros - Private prediction markets on Stellar',
    description: 'Create and trade private prediction markets with Circle USDC on Stellar.',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${instrumentSans.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  )
}
