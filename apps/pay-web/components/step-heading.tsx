"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function StepHeading({ children, as: Heading = "h1", className }: {
  children: ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const heading = ref.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    const bounds = heading.getBoundingClientRect();
    if (bounds.top < 80 || bounds.bottom > window.innerHeight - 100) heading.scrollIntoView({ block: "start" });
  }, []);
  return <Heading ref={ref} tabIndex={-1} className={className}>{children}</Heading>;
}
