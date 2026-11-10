"use client";

import { useEffect } from "react";

export function LandingMotion() {
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches || !("IntersectionObserver" in window)) return;

    let disposed = false;
    let stopHero: (() => void) | undefined;
    const animations = new Set<Animation>();
    const image = document.querySelector<HTMLImageElement>("[data-hero-image]");
    const revealHero = () => {
      if (!image) return;
      void image.decode().then(async () => {
        const bounds = image.getBoundingClientRect();
        if (disposed || preference.matches || document.hidden || bounds.bottom <= 0 || bounds.top >= window.innerHeight) return;
        const { startRiverMotion } = await import("@/lib/landing-river");
        if (!disposed && !preference.matches) stopHero = startRiverMotion(image);
      }).catch(() => {});
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        if (entry.target === image) {
          revealHero();
          continue;
        }
        const animation = entry.target.animate(
          [{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 700, easing: "cubic-bezier(.22, 1, .36, 1)" },
        );
        animations.add(animation);
        animation.onfinish = () => animations.delete(animation);
      }
    }, { threshold: 0.08 });

    if (image) observer.observe(image);

    document.querySelectorAll<HTMLElement>("[data-landing-reveal]").forEach((element) => {
      if (element.getBoundingClientRect().top >= window.innerHeight) observer.observe(element);
    });

    const stopMotion = () => {
      if (!preference.matches) return;
      stopHero?.();
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
      animations.clear();
    };
    preference.addEventListener("change", stopMotion);

    return () => {
      disposed = true;
      stopHero?.();
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
      preference.removeEventListener("change", stopMotion);
    };
  }, []);

  return null;
}
