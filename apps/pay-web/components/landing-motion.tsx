"use client";

import { useEffect } from "react";

export function LandingMotion() {
  useEffect(() => {
    let disposed = false;
    let smoothScroll: { destroy(): void } | undefined;
    const animationFrames = new Set<number>();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const countElements = document.querySelectorAll<HTMLElement>("[data-market-count]");

    const formatCount = (element: HTMLElement, value: number) => {
      const decimals = Number(element.dataset.decimals ?? 0);
      const prefix = element.dataset.prefix ?? "";
      const suffix = element.dataset.suffix ?? "";
      const formatted = value.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      element.textContent = `${prefix}${formatted}${suffix}`;
    };

    const animateCount = (element: HTMLElement, delay: number) => {
      const target = Number(element.dataset.target ?? 0);
      const duration = 1600;
      const startedAt = performance.now() + delay;

      const tick = (now: number) => {
        if (disposed) return;
        const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
        const eased = 1 - Math.pow(1 - progress, 4);
        formatCount(element, target * eased);
        if (progress < 1) {
          const frame = requestAnimationFrame(tick);
          animationFrames.add(frame);
        }
      };

      const frame = requestAnimationFrame(tick);
      animationFrames.add(frame);
    };

    if (!reduceMotion) {
      countElements.forEach((element) => formatCount(element, 0));
    }

    const elements = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const target = entry.target as HTMLElement;
        target.classList.add("isVisible");
        if (!reduceMotion && target.hasAttribute("data-count-group")) {
          target.querySelectorAll<HTMLElement>("[data-market-count]").forEach((element, index) => {
            animateCount(element, 120 + index * 110);
          });
        }
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8%", threshold: 0.2 });

    elements.forEach((element) => observer.observe(element));
    const frame = requestAnimationFrame(() => document.documentElement.classList.add("landingMotionReady"));
    void import("lenis").then(({ default: Lenis }) => {
      if (disposed) return;
      smoothScroll = new Lenis({
        anchors: true,
        autoRaf: true,
        lerp: 0.11,
        respectReducedMotion: true,
        smoothWheel: true,
        stopInertiaOnNavigate: true,
        syncTouch: false,
      });
    });

    return () => {
      disposed = true;
      smoothScroll?.destroy();
      animationFrames.forEach((frame) => cancelAnimationFrame(frame));
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.documentElement.classList.remove("landingMotionReady");
    };
  }, []);

  return null;
}
