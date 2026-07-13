import type { ReactNode } from "react";

export const ACCENT = "#eca8d6";

export function AccentDot({ active = true }: { active?: boolean }) {
  return (
    <span
      className="w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: active ? ACCENT : "rgba(255,255,255,0.2)" }}
    />
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-4 text-sm font-mono text-muted-foreground">
      <span className="w-12 h-px bg-foreground/20" />
      {children}
    </span>
  );
}

export function PageHeader({
  label,
  title,
  description,
}: {
  label: string;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="mb-12">
      <SectionLabel>{label}</SectionLabel>
      <h1 className="mt-6 text-5xl md:text-6xl lg:text-7xl font-display tracking-tight leading-[0.9]">
        {title}
      </h1>
      {description && (
        <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-2xl">
          {description}
        </p>
      )}
    </div>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative rounded-lg border border-white/[0.08] bg-white/[0.03] ${className}`}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  className = "",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <Panel className={`p-6 lg:p-8 ${className}`}>
      <span className="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className="mt-3 block text-3xl sm:text-4xl lg:text-5xl font-display tracking-tight leading-none">
        {value}
      </span>
      {sub && <span className="mt-3 block text-sm text-muted-foreground">{sub}</span>}
    </Panel>
  );
}

export function EmptyState({
  title,
  description,
  image,
  action,
}: {
  title: string;
  description?: ReactNode;
  image?: string;
  action?: ReactNode;
}) {
  return (
    <Panel className="p-12 flex flex-col items-center text-center">
      {image && (
        <img
          src={image}
          alt=""
          className="w-40 h-40 object-contain opacity-70 mb-8"
        />
      )}
      <h3 className="text-2xl font-display tracking-tight">{title}</h3>
      {description && (
        <p className="mt-3 text-muted-foreground max-w-md leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-8">{action}</div>}
    </Panel>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
      {children}
    </span>
  );
}
