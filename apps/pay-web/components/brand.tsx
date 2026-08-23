import Image from "next/image";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="Moros Pay">
      <Image className="brandMark" src="/logo-96.webp" width={96} height={96} alt="" priority />
      {!compact && (
        <span className="brandType">
          <strong>Moros</strong>
          <small>/ PAY</small>
        </span>
      )}
    </div>
  );
}
