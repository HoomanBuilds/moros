"use client";

import { useEffect, useRef } from "react";

export function LandingHeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let loaded = false;
    let failed = false;
    let disposed = false;
    const canPlay = () => !disposed && !failed && visible && !document.hidden && !preference.matches;
    const update = () => {
      if (!canPlay()) {
        video.pause();
        if (preference.matches) delete video.dataset.playing;
        return;
      }
      if (!loaded) {
        video.querySelectorAll<HTMLSourceElement>("source[data-src]").forEach((source) => {
          source.src = source.dataset.src!;
        });
        loaded = true;
        video.load();
      }
      void video.play().catch(() => {});
    };
    const playing = () => {
      if (canPlay()) video.dataset.playing = "true";
      else video.pause();
    };
    const error = () => {
      failed = true;
      delete video.dataset.playing;
    };
    const observer = "IntersectionObserver" in window
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); })
      : undefined;
    video.addEventListener("playing", playing);
    video.addEventListener("error", error);
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    if (observer) observer.observe(video);
    else { visible = true; update(); }

    return () => {
      disposed = true;
      observer?.disconnect();
      preference.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
      video.removeEventListener("playing", playing);
      video.removeEventListener("error", error);
      video.pause();
      video.querySelectorAll("source").forEach((source) => source.removeAttribute("src"));
      video.load();
    };
  }, []);

  return <video ref={ref} muted playsInline loop preload="none" aria-hidden="true" tabIndex={-1}><source data-src="/landing/garden-hero-v2.webm" type="video/webm" /><source data-src="/landing/garden-hero-v2.mp4" type="video/mp4" /></video>;
}

export function LandingMotion() {
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches || !("IntersectionObserver" in window)) return;

    const animations = new Set<Animation>();
    const ambientElements = new Set<HTMLElement>();
    const updateAmbient = () => ambientElements.forEach((element) => {
      element.dataset.motion = !document.hidden && !preference.matches ? "running" : "paused";
    });
    const ambientObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (entry.isIntersecting) ambientElements.add(element);
        else { ambientElements.delete(element); element.dataset.motion = "paused"; }
      }
      updateAmbient();
    }, { threshold: 0.15 });
    document.querySelectorAll<HTMLElement>("[data-landing-ambient]").forEach((element) => ambientObserver.observe(element));
    document.addEventListener("visibilitychange", updateAmbient);
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const animation = entry.target.animate(
          [{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 700, easing: "cubic-bezier(.22, 1, .36, 1)" },
        );
        animations.add(animation);
        animation.onfinish = () => animations.delete(animation);
      }
    }, { threshold: 0.08 });

    document.querySelectorAll<HTMLElement>("[data-landing-reveal]").forEach((element) => {
      if (element.getBoundingClientRect().top >= window.innerHeight) observer.observe(element);
    });

    const stopMotion = () => {
      updateAmbient();
      if (!preference.matches) return;
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
      animations.clear();
    };
    preference.addEventListener("change", stopMotion);

    return () => {
      ambientObserver.disconnect();
      ambientElements.forEach((element) => { element.dataset.motion = "paused"; });
      document.removeEventListener("visibilitychange", updateAmbient);
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
      preference.removeEventListener("change", stopMotion);
    };
  }, []);

  return null;
}
