import type { APIRoute } from "astro";
import { getCollection, getEntry } from "astro:content";
import { getPublications } from "../lib/pubs";
import { FOOTER_NAV } from "../lib/nav";
import { STATUS_LABEL, KIND_LABEL, range, ym, byOrder } from "../lib/format";
import { getDefense } from "../lib/defense";
import type { SearchItem } from "../lib/search";

export type { SearchItem };

/**
 * Index for the Ctrl/Cmd+K search. Built at build time and fetched lazily on first open, so it
 * costs nothing on page load. Every item has a unique `url` (the semantic API on the Space keys
 * its results by it) and, where useful, a `text` description that the API embeds for retrieval.
 */
const yearOf = (d?: string | null) => (d ? Number(d.slice(0, 4)) || undefined : undefined);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, s.lastIndexOf(" ", n)) + "…" : s);
const sentence = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(". ").replace(/\.\./g, ".");

export const GET: APIRoute = async () => {
  const me = (await getEntry("profile", "me"))!.data;
  const research = (await getEntry("research", "research"))!.data;
  const rec = (await getEntry("recognition", "recognition"))!.data;
  const thisYear = new Date().getFullYear();
  const items: SearchItem[] = [];

  /* Pages and sections */
  items.push({ type: "Page", title: "Home", url: "/", keywords: "start overview about" });
  const PAGE_HINTS: Record<string, string> = {
    "/research/": "dissertation thesis committee pathway themes",
    "/publications/": "papers bibtex citations conference journal",
    "/projects/": "github hugging face apps agents demos",
    "/experience/": "work jobs education skills timeline",
    "/service/": "reviewing reviewer awards honors certifications events hackathons",
    "/cv/": "resume curriculum vitae print",
    "/contact/": "email phone reach message form",
    "/feedback/": "testimonials reviews feedback recommend",
    "/recognition/": "news media press awards honors evidence d3code champion recognition",
  };
  if (await getDefense()) items.push({ type: "Page", title: "Ph.D. defense", subtitle: "November 16, 2026 · 2:30–4:00 PM EST · GSU and Teams", url: "/defense/", keywords: "defense dissertation phd thesis teams join calendar" });
  for (const n of FOOTER_NAV) items.push({ type: "Page", title: n.label, url: n.href, keywords: PAGE_HINTS[n.href] });

  const d = research.dissertation;
  for (const s of d.stages) {
    items.push({
      type: "Section", title: `Stage ${s.n}: ${s.name}`, subtitle: s.question, url: `/research/#stage-${s.id}`,
      text: sentence(`Dissertation stage ${s.n}, ${s.name}: ${s.question}`, `Methods: ${s.methods.join(", ")}`, d.title),
    });
  }
  items.push({ type: "Section", title: "Dissertation committee", subtitle: `Advisor: ${d.advisor}`, url: "/research/#committee-h", keywords: "advisor committee members" });
  items.push({ type: "Section", title: "M.S. thesis", subtitle: research.thesis.title, url: "/research/#thesis-h", text: sentence(`M.S. thesis (${research.thesis.year}): ${research.thesis.title}`, `Advisor: ${research.thesis.advisor}`, clip(research.thesis.summary, 300)), year: research.thesis.year });
  items.push({ type: "Section", title: "Honors and awards", url: "/service/#awards-h" });
  items.push({ type: "Section", title: "Reviewing", subtitle: "Peer review for conferences and journals", url: "/service/#review-h", keywords: "reviewer peer review" });
  items.push({ type: "Section", title: "Education", url: "/experience/#edu-h", keywords: "degrees school university" });
  items.push({ type: "Section", title: "Certifications", url: "/service/#certs-h", keywords: "certificates courses" });

  /* Publications */
  for (const p of await getPublications()) {
    const x = p.data;
    const where = x.status === "published" ? `${x.venue}${x.year ? `, ${x.year}` : ""}` : STATUS_LABEL[x.status];
    const kind = x.kind === "manuscript" ? "Manuscript" : `${KIND_LABEL[x.kind]} paper`;
    items.push({
      type: "Publication", title: x.title, subtitle: where, url: `/publications/#${p.id}`,
      text: sentence(
        `${x.title}`,
        `${kind}${x.presentation ? `, ${x.presentation} presentation` : ""}${x.year ? `, ${x.year}` : ""}`,
        x.status === "published" ? `Published in ${x.venue}` : `${STATUS_LABEL[x.status]}${x.venue && x.venue !== STATUS_LABEL[x.status] ? ` (${x.venue})` : ""}`,
        `Authors: ${x.authors}`,
      ),
      year: x.year ?? undefined, kind: x.kind, status: x.status, oral: x.presentation === "oral" || undefined,
    });
  }

  /* Projects */
  for (const p of await getCollection("projects")) {
    const x = p.data;
    items.push({
      type: "Project", title: x.title, subtitle: x.stack.slice(0, 4).join(" · "), url: `/projects/#${p.id}`,
      keywords: x.tags.join(" "),
      text: sentence(`${x.title}: ${x.description}`, `Built with ${x.stack.join(", ")}`, `Links: ${x.links.map((l) => l.label).join(", ")}`),
      year: yearOf(x.date),
    });
  }

  /* People */
  const advisors = [d.advisor, research.thesis.advisor];
  for (const p of (await getCollection("people")).sort(byOrder)) {
    const x = p.data;
    items.push({
      type: "Person", title: x.name, subtitle: x.role, url: `/research/#person-${p.id}`,
      keywords: advisors.some((a) => x.name.includes(a)) ? "Ph.D. advisor, M.S. thesis advisor, primary advisor" : undefined,
      text: sentence(`${x.name}: ${x.role}`, x.group === "committee" ? "Member of the Ph.D. dissertation committee" : "Research collaborator", x.note),
    });
  }

  /* Awards: the Recognition page holds the evidence; honors without a page there link to the Service list. */
  const titleWords = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(and|the|for|award|awards)$/.test(w)));
  for (const a of rec.awards) {
    items.push({
      type: "Award", title: a.title, subtitle: `${a.org} · ${ym(a.date)}`, url: `/recognition/#${a.id}`,
      text: sentence(`${a.title}, ${a.org}, ${ym(a.date)}`, clip(a.summary, 520)),
      year: yearOf(a.date),
    });
  }
  for (const a of (await getCollection("awards")).sort(byOrder)) {
    const x = a.data;
    if (x.url?.startsWith("/recognition/")) continue;
    const words = titleWords(x.title);
    const dup = rec.awards.some((r) => yearOf(r.date) === x.year && [...titleWords(r.title)].filter((w) => words.has(w)).length >= 2);
    if (dup) continue;
    items.push({
      type: "Award", title: x.title, subtitle: `${x.org}${x.year ? ` · ${x.year}` : ""}`, url: `/service/#award-${a.id}`,
      text: sentence(`${x.title}, ${x.org}${x.year ? `, ${x.year}` : ""}`, x.detail),
      year: x.startYear ?? x.year ?? undefined, yearEnd: x.startYear && x.year ? x.year : undefined,
    });
  }

  /* Experience and education */
  for (const j of await getCollection("experience")) {
    const x = j.data;
    items.push({
      type: "Experience", title: x.role, subtitle: `${x.org} · ${range(x.start, x.end)}`, url: `/experience/#exp-${j.id}`,
      text: sentence(`${x.role} at ${x.org}, ${x.location}, ${range(x.start, x.end)}`, ...x.highlights.map((h) => h.replace(/\.$/, ""))),
      year: yearOf(x.start), yearEnd: yearOf(x.end), current: !x.end || undefined,
    });
  }
  for (const s of await getCollection("education")) {
    const x = s.data;
    const end = yearOf(x.end);
    items.push({
      type: "Education", title: x.degree, subtitle: `${x.school} · ${range(x.start, x.end, x.expected)}`, url: `/experience/#edu-${s.id}`,
      text: sentence(`${x.degree}, ${x.school}, ${x.location}, ${range(x.start, x.end, x.expected)}`, `GPA ${x.gpa}`, x.note, `Coursework: ${x.coursework.join(", ")}`),
      year: yearOf(x.start), yearEnd: end, current: (end != null && end >= thisYear && x.expected) || undefined,
    });
  }

  /* Certifications */
  for (const c of (await getCollection("certifications")).sort(byOrder)) {
    const x = c.data;
    items.push({
      type: "Certification", title: x.title, subtitle: `${x.issuer}${x.date ? ` · ${ym(x.date)}` : ""}`, url: `/service/#cert-${c.id}`,
      text: sentence(`Certification: ${x.title}, issued by ${x.issuer}${x.date ? `, ${ym(x.date)}` : ""}`, x.note),
      year: yearOf(x.date),
    });
  }

  /* Documents and profiles */
  const DOCS: Record<string, [string, string]> = {
    resume: ["Industry resume (PDF)", "Resume: industry experience, skills, education"],
    research_resume: ["Research CV (PDF)", "Academic curriculum vitae: research, publications, teaching, service"],
    research_statement: ["Research statement (PDF)", "Research statement: research agenda and future directions"],
    ms_thesis: ["M.S. thesis (PDF)", `M.S. thesis: ${research.thesis.title}`],
  };
  for (const [k, url] of Object.entries(me.documents)) {
    items.push({ type: "Document", title: DOCS[k]?.[0] ?? k, url, external: true, text: DOCS[k]?.[1] });
  }
  items.push({ type: "Document", title: "All publications (BibTeX)", url: "/publications.bib", external: true, text: "BibTeX citations for all publications" });

  const PROFILE: Record<string, string> = {
    linkedin: "LinkedIn", github: "GitHub", scholar: "Google Scholar", orcid: "ORCID", openreview: "OpenReview",
    huggingface: "Hugging Face", researchgate: "ResearchGate", webofscience: "Web of Science", kaggle: "Kaggle", medium: "Medium",
  };
  for (const [k, url] of Object.entries(me.links)) {
    if (url) items.push({ type: "Profile", title: PROFILE[k] ?? k, url, external: true, text: `${PROFILE[k] ?? k} profile` });
  }

  // URLs are the key the semantic API returns; keep them unique.
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    if (seen.has(i.url)) { console.warn(`search-index: duplicate url ${i.url} (${i.title}) skipped`); return false; }
    seen.add(i.url);
    return true;
  });

  return new Response(JSON.stringify(unique), { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
