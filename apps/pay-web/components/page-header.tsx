export function PageHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="pageHeader">
      <p className="sectionLabel"><span />{eyebrow}</p>
      <h1>{title}</h1>
      <p className="muted">{description}</p>
    </header>
  );
}
