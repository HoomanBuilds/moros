import Image from "next/image";

export function StellarWordmark({
  className = "",
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/brands/stellar-wordmark-white.png"
      alt="Stellar"
      width={6231}
      height={1560}
      priority={priority}
      className={`h-auto ${className}`}
    />
  );
}
