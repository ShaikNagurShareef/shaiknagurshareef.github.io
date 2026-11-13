import type { APIRoute } from "astro";
import { getCollection, getEntry } from "astro:content";
import { getPublications } from "../lib/pubs";
import { FOOTER_NAV } from "../lib/nav";
import { STATUS_LABEL } from "../lib/format";
import { getDefense } from "../lib/defense";

/**
 * Index for the Ctrl/Cmd+K command palette. Built at build time and fetched lazily on first open,
 * so it costs nothing on page load.
 */
export interface SearchItem {
  type: "Page" | "Section" | "Publication" | "Project" | "Person" | "Document" | "Profile";
  title: string;
  subtitle?: string;
  url: string;
  external?: boolean;
  keywords?: string;
}

export const GET: APIRoute = async () => {
  const me = (await getEntry("profile", "me"))!.data;
  const research = (await getEntry("research", "research"))!.data;
  const items: SearchItem[] = [];

  items.push({ type: "Page", title: "Home", url: "/", keywords: "start overview about" });
  const PAGE_HINTS: Record<string, string> = {
    "/research/": "dissertation thesis committee pathway themes",
    "/publications/": "papers bibtex citations conference journal",
    "/projects/": "github hugging face apps agents",
    "/experience/": "work jobs education skills timeline",
    "/service/": "reviewing reviewer awards honors certifications events hackathons",
    "/cv/": "resume curriculum vitae print",
    "/contact/": "email phone reach message form",
    "/feedback/": "testimonials reviews feedback recommend",
  };
  if (await getDefense()) items.push({ type: "Page", title: "Ph.D. defense", subtitle: "November 16, 2026 · 2:30–4:00 PM EST · GSU and Teams", url: "/defense/", keywords: "defense dissertation phd thesis teams join calendar" });
  for (const n of FOOTER_NAV) items.push({ type: "Page", title: n.label, url: n.href, keywords: PAGE_HINTS[n.href] });

  for (const s of research.dissertation.stages) {
    items.push({
      type: "Section", title: `Stage ${s.n}: ${s.name}`, subtitle: s.question,
      url: `/research/#stage-${s.id}`, keywords: s.methods.join(" "),
    });
  }
  items.push({ type: "Section", title: "Dissertation committee", url: "/research/#committee-h" });
  items.push({ type: "Section", title: "M.S. thesis", subtitle: research.thesis.title, url: "/research/#thesis-h" });
  items.push({ type: "Section", title: "Honors and awards", url: "/service/#awards-h" });
  items.push({ type: "Section", title: "Reviewing", url: "/service/#review-h" });

  for (const p of await getPublications()) {
    const where = p.data.status === "published" ? `${p.data.venue}${p.data.year ? `, ${p.data.year}` : ""}` : STATUS_LABEL[p.data.status];
    items.push({ type: "Publication", title: p.data.title, subtitle: where, url: `/publications/#${p.id}`, keywords: p.data.authors });
  }

  for (const p of await getCollection("projects")) {
    items.push({ type: "Project", title: p.data.title, subtitle: p.data.stack.slice(0, 4).join(" · "), url: `/projects/#${p.id}`, keywords: `${p.data.tags.join(" ")} ${p.data.description}` });
  }

  for (const p of await getCollection("people")) {
    items.push({ type: "Person", title: p.data.name, subtitle: p.data.role, url: `/research/#person-${p.id}` });
  }

  const DOCS: Record<string, string> = {
    resume: "Industry resume (PDF)", research_resume: "Research CV (PDF)",
    research_statement: "Research statement (PDF)", ms_thesis: "M.S. thesis (PDF)",
  };
  for (const [k, url] of Object.entries(me.documents)) {
    items.push({ type: "Document", title: DOCS[k] ?? k, url, external: true });
  }
  items.push({ type: "Document", title: "All publications (BibTeX)", url: "/publications.bib", external: true });

  const PROFILE: Record<string, string> = {
    linkedin: "LinkedIn", github: "GitHub", scholar: "Google Scholar", orcid: "ORCID", openreview: "OpenReview",
    huggingface: "Hugging Face", researchgate: "ResearchGate", webofscience: "Web of Science", kaggle: "Kaggle", medium: "Medium",
  };
  for (const [k, url] of Object.entries(me.links)) {
    if (url) items.push({ type: "Profile", title: PROFILE[k] ?? k, url, external: true });
  }

  return new Response(JSON.stringify(items), { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
