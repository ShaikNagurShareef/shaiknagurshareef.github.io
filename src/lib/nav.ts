export const NAV = [
  { href: "/research/", label: "Research" },
  { href: "/publications/", label: "Publications" },
  { href: "/projects/", label: "Projects" },
  { href: "/experience/", label: "Experience" },
  { href: "/service/", label: "Service" },
  { href: "/cv/", label: "CV" },
  { href: "/contact/", label: "Contact" },
] as const;

export const isActive = (pathname: string, href: string) =>
  pathname === href || pathname === href.replace(/\/$/, "") || pathname.startsWith(href);
