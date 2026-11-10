import type { Metadata, Viewport } from "next";
import { NetworkStellar } from "@web3icons/react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Code2, Link2, LockKeyhole, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { LandingMotion } from "@/components/landing-motion";
import { UsdcIcon } from "@/components/payment-icons";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "Moros | Payments on your terms",
  description: "Private USDC payments and financial infrastructure on Stellar. Send, receive, and request USDC today. USDC-to-INR payments and Android are in development.",
  openGraph: { title: "Moros | Payments on your terms", description: "A private way to move USDC. More ways to pay, coming next." },
  twitter: { title: "Moros | Payments on your terms", description: "Private USDC payments and financial infrastructure on Stellar." },
};

export const viewport: Viewport = { themeColor: "#faf9f6", colorScheme: "light" };

function Wordmark() {
  return <span className={styles.wordmark}><Image src="/logo-96.webp" width={36} height={36} alt="" /><span>moros</span></span>;
}

function OpenApp({ children = "Open Moros", className = "" }: { children?: React.ReactNode; className?: string }) {
  return <Link href="/app" className={`${styles.button} ${className}`}>{children}<ArrowUpRight size={18} aria-hidden="true" /></Link>;
}

function PaymentPreview() {
  return (
    <figure className={styles.preview}>
      <div className={styles.previewSurface}>
        <div className={styles.previewHeader}><span>Moros Pay</span><span><LockKeyhole size={13} aria-hidden="true" /> Your private space</span></div>
        <div className={styles.previewBody}>
          <div className={styles.previewWallet}>
            <span className={styles.smallLabel}>Available privately</span>
            <div className={styles.previewBalance}><UsdcIcon size={36} /><strong>250<span>.00</span></strong><span>USDC</span></div>
            <p>A balance that stays between you and your wallet.</p>
            <div className={styles.previewActions} aria-hidden="true"><span><ArrowUpRight size={16} /> Send</span><span><ArrowDownLeft size={16} /> Receive</span><span><Plus size={16} /> Add USDC</span></div>
            <div className={styles.previewActivity}><div><span className={styles.recipientAvatar}>M</span><div><strong>Payment request</strong><span>Shared with a private link</span></div><Link2 size={18} aria-hidden="true" /></div></div>
          </div>
          <div className={styles.previewPayment}>
            <div className={styles.previewPaymentTop}><span>Private payment</span><ArrowUpRight size={19} aria-hidden="true" /></div>
            <span className={styles.smallLabel}>You send</span><div className={styles.previewAmount}>25.00 <span>USDC</span></div>
            <dl><div><dt>To</dt><dd>Your verified recipient</dd></div><div><dt>Payment details</dt><dd><LockKeyhole size={12} aria-hidden="true" /> Encrypted</dd></div><div><dt>Settlement</dt><dd><NetworkStellar size={15} variant="mono" aria-hidden="true" /> Stellar</dd></div></dl>
            <span className={styles.previewReview}>Review payment <ArrowRight size={16} aria-hidden="true" /></span>
          </div>
        </div>
      </div>
      <figcaption>Product preview. Example amounts.</figcaption>
    </figure>
  );
}

const capabilities = [
  { title: "Send privately.", body: "Pay a verified Moros recipient without publishing the individual payment amount or destination.", href: "/app/send", action: "Send USDC" },
  { title: "Get paid with a link.", body: "Create a signed payment request, set an amount, and share it. The recipient and request are verified before payment.", href: "/app/request", action: "Create a request" },
  { title: "Keep your balance moving.", body: "Receive, send again, or withdraw to a Stellar wallet. Recover your private wallet and encrypted history across devices.", href: "/app/receive", action: "Receive USDC" },
];

const questions = [
  { question: "What can I use on Moros today?", answer: "Moros Pay is live on Stellar mainnet. You can add Circle USDC to a private balance, send it to another Moros recipient, receive payments, create signed payment requests, and withdraw USDC to a Stellar account. Private contacts, encrypted history, and wallet recovery are also available." },
  { question: "Can I use my existing Stellar wallet?", answer: "Yes. Connect a supported Stellar wallet to add USDC. Your Moros private payment identity is separate from the connected wallet, and you can create or restore it in the app." },
  { question: "What does private mean here?", answer: "Inside Moros, individual payment amounts and recipients are protected by encrypted notes and zero-knowledge proofs. You recover your balance and history with your own keys. Stellar still verifies the settlement. Adding or withdrawing USDC is an on-chain transfer visible on Stellar." },
  { question: "Can I pay a UPI QR with USDC yet?", answer: "Not yet. USDC-to-INR conversion and UPI merchant QR payments are planned through payment partners. These will be optional alongside private and standard USDC transfers. They are upcoming features, not currently available payment routes." },
  { question: "Is the Android app available?", answer: "The Android app is under development. It is planned to support private USDC payments, payment links, QR scanning, and wallet recovery. Use the web app today; an Android download will be linked here when it is available." },
  { question: "Can another application build on Moros?", answer: "The repository includes shared Soroban payment contracts, payment circuits, a Rust cryptography core, browser bindings, and a payment client library. Explore the implementation on GitHub. A documented integration SDK and broader developer onboarding are part of the next phase." },
];

export default function LandingPage() {
  return (
    <div className={styles.page} id="top">
      <LandingMotion /><a className={styles.skipLink} href="#main">Skip to content</a>
      <header className={styles.header}>
        <Link href="/" aria-label="Moros home"><Wordmark /></Link>
        <nav aria-label="Main navigation"><a href="#payments">Payments</a><a href="#next">What&apos;s next</a><a href="#infrastructure">For builders</a></nav>
        <OpenApp />
      </header>
      <main id="main" tabIndex={-1}>
        <section className={`${styles.hero} ${styles.container}`} aria-labelledby="hero-title">
          <div className={styles.heroHeading}><h1 id="hero-title">Money moves.<br /><em>On your terms.</em></h1><div className={styles.heroAside}><span className={styles.stellarLabel}>Built on <NetworkStellar size={20} variant="mono" aria-hidden="true" /><strong>Stellar</strong></span><p>Send and request private Circle USDC on Stellar. Keep a reusable balance, with INR and UPI payments coming next.</p><OpenApp>Start with Moros</OpenApp></div></div>
          <figure className={styles.heroScene}><Image data-hero-image src="/landing/moros-river.webp" alt="A sunlit stream flowing beneath a pale stone footbridge, surrounded by greenery and soft pink flowers" fill priority sizes="(min-width: 1600px) 1440px, 90vw" /></figure>

        </section>

        <section className={`${styles.payments} ${styles.container}`} id="payments" aria-labelledby="payments-title">
          <div className={styles.sectionHeading} data-landing-reveal><div><h2 id="payments-title">A payment is personal.<br /><em>Keep it that way.</em></h2></div><p>A reusable private USDC balance for the people you pay and the work you get paid for.</p></div>
          <div data-landing-reveal><PaymentPreview /></div>
          <div className={styles.capabilities}>{capabilities.map(({ title, body, href, action }) => <article key={title} data-landing-reveal><h3>{title}</h3><p>{body}</p><Link href={href} className={styles.textLink}>{action}<ArrowUpRight size={16} aria-hidden="true" /></Link></article>)}</div>
        </section>

        <section className={styles.nextSection} id="next" aria-labelledby="next-title">
          <div className={`${styles.nextInner} ${styles.container}`}>
            <div className={styles.nextCopy} data-landing-reveal><span className={styles.upcoming}>Upcoming / USDC to INR</span><h2 id="next-title">USDC for<br /><em>everyday payments.</em></h2><p>Scan a UPI QR and pay with USDC.</p><a href="https://x.com/morosxyz" className={styles.textLink} target="_blank" rel="noopener noreferrer">Follow the build<ArrowUpRight size={16} aria-hidden="true" /></a></div>
            <figure className={styles.inrVisual} data-landing-reveal><div className={styles.checkoutScene}><Image src="/landing/moros-checkout.webp" alt="An illustrated future checkout experience: a phone held near a merchant payment stand at a cafe" fill sizes="(max-width: 560px) 90vw, 45vw" /></div><div className={styles.currencyPair}><span><UsdcIcon size={24} />USDC</span><ArrowRight size={21} strokeWidth={1} aria-hidden="true" /><span className={styles.rupee}>₹<span>INR</span></span></div></figure>
          </div>
        </section>

        <section className={`${styles.infrastructure} ${styles.container}`} id="infrastructure" aria-labelledby="infrastructure-title">
          <div className={styles.sectionHeading} data-landing-reveal><h2 id="infrastructure-title">Private payments.<br /><em>Shared infrastructure.</em></h2><a className={styles.textLink} href="https://github.com/HoomanBuilds/moros" target="_blank" rel="noopener noreferrer">Explore the infrastructure<ArrowUpRight size={16} aria-hidden="true" /></a></div>
          <div className={styles.network} data-landing-reveal>
            <div className={styles.mapCanvas}>
              <svg className={styles.mapLines} viewBox="0 0 1000 640" preserveAspectRatio="none" aria-hidden="true">
                <path d="M500 100V320M115 180H300Q330 180 330 210V290Q330 320 370 320H500M115 450H300Q330 450 330 420V350Q330 320 370 320H500M500 320V590" />
                <path className={styles.futureLine} d="M885 180H700Q670 180 670 210V290Q670 320 630 320H500M885 450H700Q670 450 670 420V350Q670 320 630 320H500" />
              </svg>
              <div className={`${styles.mapNode} ${styles.mapWallet}`}><div className={styles.mapBrand}><NetworkStellar size={26} variant="mono" aria-hidden="true" /><strong>Your Stellar wallet</strong></div><span>Add or withdraw Circle USDC</span></div>
              <Link href="/app" className={`${styles.mapNode} ${styles.mapWeb}`}><div className={styles.mapBrand}><Image src="/logo-96.webp" alt="" width={30} height={30} /><strong>Moros Pay</strong><ArrowUpRight className={styles.nodeArrow} size={15} aria-hidden="true" /></div><span>Send, receive, and request USDC</span></Link>
              <div className={`${styles.mapNode} ${styles.mapAndroid}`}><div className={styles.mapBrand}><Image src="/landing/android.svg" alt="" width={30} height={30} /><strong>Moros Android</strong></div><span>Private payments on the go</span><small>In development</small></div>
              <div className={styles.mapCore}><Wordmark /><strong>Private payment infrastructure</strong><p>Encrypted notes and client-side proofs.</p></div>
              <a href="https://github.com/HoomanBuilds/moros/tree/main/packages" target="_blank" rel="noopener noreferrer" className={`${styles.mapNode} ${styles.mapBuilders}`}><div className={styles.mapBrand}><Code2 size={27} strokeWidth={1.3} aria-hidden="true" /><strong>Your application</strong><ArrowUpRight className={styles.nodeArrow} size={15} aria-hidden="true" /></div><span>Shared contracts and client libraries</span></a>
              <a href="#next" className={`${styles.mapNode} ${styles.mapUpi}`}><div className={styles.mapBrand}><Image src="/landing/upi.svg" alt="UPI" width={82} height={29} /><ArrowUpRight className={styles.nodeArrow} size={15} aria-hidden="true" /></div><strong>USDC to INR</strong><small>Upcoming through payment partners</small></a>
              <div className={`${styles.mapNode} ${styles.mapSettlement}`}><div className={styles.settlementBrands}><NetworkStellar size={27} variant="mono" aria-hidden="true" /><strong>Stellar</strong><span>+</span><UsdcIcon size={25} /><strong>USDC</strong></div><span>Proofs verified. Payments settled.</span></div>
            </div>
          </div>
        </section>

        <section className={`${styles.roadmap} ${styles.container}`} aria-labelledby="roadmap-title">
          <div className={styles.roadmapIntro} data-landing-reveal><h2 id="roadmap-title">Your money.<br /><em>Your choice.</em></h2><p>Use what fits. Each way to pay is optional, and upcoming features will be added alongside the private wallet.</p></div>
          <div className={styles.roadmapRows}>
            <article data-landing-reveal><span className={styles.available}>Available</span><h3>Private USDC payments</h3><p>Send, receive, request, and reuse a shielded USDC balance.</p><Link href="/app" aria-label="Open private USDC payments"><ArrowUpRight size={22} aria-hidden="true" /></Link></article>
            <article data-landing-reveal><span>Upcoming</span><h3>Standard USDC transfers</h3><p>A straightforward way to send USDC to a Stellar wallet.</p></article>
            <article data-landing-reveal><span>Upcoming</span><h3>USDC to INR + UPI</h3><p>USDC-funded INR payments to UPI merchants through payment partners.</p></article>
            <article data-landing-reveal><span>In development</span><h3>Moros on Android</h3><p>Your private wallet, payment links, and QR scanning on the go.</p></article>
            <article data-landing-reveal><span>Expanding</span><h3>Infrastructure for builders</h3><p>A documented SDK and integration tools on top of the shared payment layer.</p></article>
          </div>
        </section>

        <section className={`${styles.faq} ${styles.container}`} aria-labelledby="faq-title"><div data-landing-reveal><h2 id="faq-title">Good to know.</h2></div><div className={styles.questions}>{questions.map(({ question, answer }) => <details key={question}><summary>{question}<Plus size={19} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div></section>
        <section className={`${styles.closing} ${styles.container}`} aria-labelledby="closing-title" data-landing-reveal><div className={styles.closingPanel}><h2 id="closing-title">A private place<br /><em>for your money.</em></h2><OpenApp>Open Moros Pay</OpenApp></div></section>
      </main>
      <footer className={`${styles.footer} ${styles.container}`}><div className={styles.footerTop}><Link href="/" aria-label="Moros home"><Wordmark /></Link><p>Payments and private financial<br />infrastructure on Stellar.</p><div><a href="https://github.com/HoomanBuilds/moros" target="_blank" rel="noopener noreferrer">GitHub<ArrowUpRight size={14} aria-hidden="true" /></a><a href="https://x.com/morosxyz" target="_blank" rel="noopener noreferrer">X / Twitter<ArrowUpRight size={14} aria-hidden="true" /></a><Link href="/app">Open app<ArrowUpRight size={14} aria-hidden="true" /></Link></div></div><div className={styles.footerBottom}><span>Moros / {new Date().getFullYear()}</span><span><UsdcIcon size={17} /> Circle USDC <span className={styles.footerDivider}>/</span><NetworkStellar size={17} variant="mono" aria-hidden="true" /> Stellar</span></div></footer>
    </div>
  );
}
