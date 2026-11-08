export const NAV = [
  { href: "/research/", label: "Research" },
  { href: "/publications/", label: "Publications" },
  { href: "/projects/", label: "Projects" },
  { href: "/experience/", label: "Experience" },
  { href: "/service/", label: "Service" },
  { href: "/cv/", label: "CV" },
] as const;

/** Footer links: the main sections plus contact and feedback (kept out of the header). */
export const FOOTER_NAV = [
  ...NAV,
  { href: "/contact/", label: "Contact" },
  { href: "/feedback/", label: "Feedback" },
] as const;

export const isActive = (pathname: string, href: string) =>
  pathname === href || pathname === href.replace(/\/$/, "") || pathname.startsWith(href);
