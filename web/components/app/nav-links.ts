export interface NavItem {
  name: string;
  href: string;
}
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    items: [
      { name: "Markets", href: "/app" },
      { name: "Portfolio", href: "/app/portfolio" },
      { name: "Profile", href: "/app/profile" },
    ],
  },
];

export function isActive(pathname: string, href: string): boolean {
  const base = href.split("#")[0];
  if (base === "/app") return pathname === "/app";
  return pathname === base || pathname.startsWith(`${base}/`);
}
