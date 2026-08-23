import {
  ArrowRight,
  Fingerprint,
  ReceiptText,
  RotateCw,
  Send,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { LandingMotion } from "@/components/landing-motion";
import { UsdcIcon } from "@/components/payment-icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { productUrls } from "@/lib/product-urls";

const marketNumbers = [
  { value: "$72.7B", target: 72.7, decimals: 1, prefix: "$", suffix: "B", label: "USDC in circulation", source: "Circle, 20 Aug 2026" },
  { value: "$256M+", target: 256, decimals: 0, prefix: "$", suffix: "M+", label: "USDC on Stellar", source: "Market cap, Q1 2026" },
  { value: "$5.5B", target: 5.5, decimals: 1, prefix: "$", suffix: "B", label: "Stellar stablecoin payments", source: "Payment volume, Q1 2026" },
  { value: "3.6B", target: 3.6, decimals: 1, prefix: "", suffix: "B", label: "Stellar transactions", source: "Processed in 2025" },
];

export default function LandingPage() {
  return (
    <main className="landing">
      <LandingMotion />

      <header className="landingNav">
        <Link href="/" aria-label="Moros Pay home"><Brand /></Link>
        <div className="landingNavCenter" aria-label="Page navigation">
          <a href="#private-path">Product</a>
          <a href="#private-by-design">Privacy</a>
          <a href="#how-it-works">How it works</a>
          <a href={productUrls.predict}>Prediction markets</a>
        </div>
        <div className="landingNavActions">
          <ThemeToggle />
          <Link className="button primary landingNavCta" href="/app">Open app <ArrowRight size={16} /></Link>
        </div>
      </header>

      <section className="landingHero">
        <div className="landingHeroCopy">
          <p className="sectionLabel"><span />Private payment infrastructure</p>
          <h1><span>Private</span><span>money</span><span>in <em>motion.</em></span></h1>
          <p className="landingHeroLead">A reusable private Circle USDC balance for payments, requests, merchant checkout, and withdrawal on Stellar.</p>
        </div>

        <div className="landingHeroVisual" aria-label="Private payment secured by Moros">
          <Image
            className="landingHeroImage"
            src="/railgun-hand-light.webp"
            fill
            priority
            sizes="(max-width: 840px) 100vw, 52vw"
            alt="A hand holding a phone for a private payment"
          />
          <div className="landingHeroImageShade" />
          <div className="landingVisualTop"><span>Moros private rail</span><b><i />Active</b></div>
          <div className="landingVisualMessage">
            <span>Private by default</span>
            <strong>Payment details stay between sender and recipient.</strong>
          </div>
          <div className="landingVisualFoot">
            <div><span>Asset</span><strong><UsdcIcon size={22} />USDC</strong></div>
            <div><span>Network</span><strong>Stellar</strong></div>
            <div><span>State</span><strong>Private</strong></div>
          </div>
        </div>
      </section>

      <section className="landingProof" id="private-path" data-reveal>
        <header className="landingProofIntro">
          <Image
            className="landingProofImage"
            src="/private-jet-square.webp"
            fill
            sizes="(max-width: 899px) 100vw, 50vw"
            alt=""
          />
          <p className="sectionLabel"><span />The private path</p>
          <h2>One balance.<br /><em>No exposed trail.</em></h2>
          <p>Add, pay, receive, and reuse Circle USDC through one private payment rail.</p>
        </header>
        <div className="landingProofSequence">
          <article className="landingProofRow">
            <div className="landingProofCopy"><span>01</span><h3>Add once</h3><p>Move Circle USDC from your Stellar wallet into one reusable private balance.</p></div>
            <div className="landingStepGraphic landingStepDeposit" aria-hidden="true">
              <i /><i /><i /><span><UsdcIcon size={30} /></span>
            </div>
          </article>
          <article className="landingProofRow">
            <div className="landingProofCopy"><span>02</span><h3>Pay privately</h3><p>Send to a Moros identity or signed request without publishing individual payment details.</p></div>
            <div className="landingStepGraphic landingStepTransfer" aria-hidden="true">
              <span><Fingerprint size={22} /></span><i /><b /><span><Send size={21} /></span>
            </div>
          </article>
          <article className="landingProofRow">
            <div className="landingProofCopy"><span>03</span><h3>Keep moving</h3><p>Reuse received USDC privately or withdraw it to any Stellar account when you choose.</p></div>
            <div className="landingStepGraphic landingStepReuse" aria-hidden="true">
              <i /><span><RotateCw size={26} /></span><strong>USDC</strong>
            </div>
          </article>
        </div>
      </section>

      <section className="landingPaymentScene" data-reveal>
        <Image className="landingSceneImage" src="/private-payment-halftone.webp" fill sizes="100vw" alt="A private phone payment at a merchant terminal" />
        <div className="landingSceneShade" />
        <div className="landingSceneCopy">
          <p className="sectionLabel"><span />From links to checkout</p>
          <h2>Private payments that move with you.</h2>
          <p>Use signed links on the web and QR checkout on Android, backed by the same reusable private USDC balance.</p>
          <Link className="button landingSceneCta" href="/app/request">Create a payment request <ArrowRight size={17} /></Link>
        </div>
      </section>

      <section className="landingScale" data-reveal data-count-group aria-labelledby="market-scale-title">
        <header className="landingScaleIntro">
          <p className="sectionLabel"><span />Market scale</p>
          <h2 id="market-scale-title">The rails are<br /><em>already global.</em></h2>
          <p>Moros brings private movement to established Circle USDC and Stellar payment infrastructure.</p>
        </header>
        <div className="landingScaleGrid">
          {marketNumbers.map(({ value, target, decimals, prefix, suffix, label, source }, index) => (
            <article key={label}>
              <span className="landingIndex">0{index + 1}</span>
              <strong aria-label={value}>
                <span
                  aria-hidden="true"
                  data-market-count
                  data-target={target}
                  data-decimals={decimals}
                  data-prefix={prefix}
                  data-suffix={suffix}
                >
                  {value}
                </span>
              </strong>
              <h3>{label}</h3>
              <cite>{source}</cite>
            </article>
          ))}
        </div>
      </section>

      <section className="landingJet" data-reveal>
        <Image className="landingJetImage" src="/private-jet.webp" fill sizes="100vw" alt="A turbine representing fast private payments" />
        <div className="landingJetShade" />
        <div className="landingJetCopy">
          <p className="sectionLabel"><span />Private at speed</p>
          <h2>Move fast.<br /><em>Leave less behind.</em></h2>
          <p>Moros turns a private balance into a payment rail built for immediate reuse, without turning every payment into public history.</p>
        </div>
      </section>

      <section className="landingMovement" data-reveal>
        <div className="landingMovementImage">
          <Image className="landingRunningImage" src="/railgun-running.webp" fill sizes="(max-width: 840px) 100vw, 50vw" alt="A person moving through a private payment network" />
          <div className="landingMovementScan" />
          <span className="landingMovementTag">Private value in motion</span>
        </div>
        <div className="landingMovementCopy">
          <p className="sectionLabel"><span />Built to keep moving</p>
          <h2>Receive once.<br />Spend again.</h2>
          <p>Private USDC does not stop at the first recipient. It stays reusable for another payment, a request, or a withdrawal.</p>
        </div>
      </section>

      <section className="landingStatement" id="private-by-design" data-reveal>
        <Image className="landingPrivacyImage" src="/privacy-hand-halftone.webp" fill sizes="100vw" alt="A private payment moving between phones" />
        <div className="landingStatementCopy">
          <p className="sectionLabel"><span />Built for private movement</p>
          <h2>Your balance.<br />Your recipients.<br /><em>Your history.</em></h2>
          <p>Moros keeps payment details inside encrypted wallet state while proof-based settlement remains verifiable on Stellar.</p>
        </div>
        <div className="landingPrivacyLedger" aria-label="Private payment properties">
          <div><span>01</span><strong>Payment amount</strong><b>Private</b></div>
          <div><span>02</span><strong>Recipient identity</strong><b>Private</b></div>
          <div><span>03</span><strong>Wallet activity</strong><b>Encrypted</b></div>
          <div><span>04</span><strong>USDC settlement</strong><b>Verifiable</b></div>
        </div>
      </section>

      <section className="landingHow" id="how-it-works" data-reveal>
        <div className="landingHowIntro">
          <p className="sectionLabel"><span />How it works</p>
          <h2>Privacy without friction.</h2>
          <p>Keep the Stellar wallet and Circle USDC you already use. Moros changes what everyone else can see.</p>
        </div>
        <ol>
          <li><span>01</span><div><strong>Add USDC</strong><p>Connect the Stellar wallet you already use and add Circle USDC to a private balance.</p></div></li>
          <li><span>02</span><div><strong>Choose a private destination</strong><p>Paste a Moros identity, open a signed request, or scan it from the Android app.</p></div></li>
          <li><span>03</span><div><strong>Prove and settle</strong><p>The payment is authorized privately and settled verifiably through Stellar.</p></div></li>
        </ol>
      </section>

      <section className="landingFinal" data-reveal>
        <ReceiptText size={25} />
        <h2>Money can be useful without becoming public history.</h2>
        <p>One private wallet for Circle USDC payments, signed requests, encrypted recovery, and proof-based settlement.</p>
        <Link className="button primary" href="/app">Start with Moros Pay <ArrowRight size={17} /></Link>
      </section>

      <footer className="landingFooter"><Brand compact /><span>Private USDC payments on Stellar.</span><a href={productUrls.predict}>Moros Predict</a></footer>
    </main>
  );
}
