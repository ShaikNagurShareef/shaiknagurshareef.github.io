/**
 * Typed content collections. Every collection is validated at build time, so malformed
 * data (from a person or from the maintenance agent) fails the build instead of shipping.
 *
 * - data/*.json      machine-maintained data (publications, projects, profile); the agent may edit these
 * - content/*.json   locked facts (experience, education, research, people, honors); edited by hand only
 */
import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(root, rel), "utf8"));

const link = z.object({ label: z.string().min(1), url: z.string().min(1) });
const yearMonth = z.string().regex(/^\d{4}(-\d{2})?(-\d{2})?$/, "use YYYY, YYYY-MM or YYYY-MM-DD");

const slug = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80);
const SUPERSCRIPT: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
const stripHtml = (s = "") =>
  s
    .replace(/<sup>(\d+)<\/sup>/g, (_, d: string) => [...d].map((c) => SUPERSCRIPT[c]).join("")) // C<sup>2</sup>A -> C²A
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/* ---------------- publications (normalized from the legacy JSON files) ---------------- */
const PUB_SOURCES = [
  { file: "data/conferences.json", kind: "conference" },
  { file: "data/journals.json", kind: "journal" },
  { file: "data/workshops.json", kind: "workshop" },
  { file: "data/under-review.json", kind: "manuscript" },
] as const;

type RawPub = { url?: string; title: string; medium?: string; authors?: string; year?: string | number; new?: string };

function normalizePub(raw: RawPub, kind: (typeof PUB_SOURCES)[number]["kind"]) {
  const medium = stripHtml(raw.medium);
  const lower = medium.toLowerCase();
  const status =
    kind !== "manuscript" ? "published"
    : lower.startsWith("submitted") ? "submitted"
    : lower.includes("in preparation") ? "in-preparation"
    : "under-review";
  const presentation = /\boral\b/i.test(medium) ? "oral" : /\bposter\b/i.test(medium) ? "poster" : null;
  const venue = medium.replace(/\s*-\s*(Oral|Poster)\b.*$/i, "").trim();
  const url = raw.url && !raw.url.startsWith("#") ? raw.url : null;
  return {
    id: slug(stripHtml(raw.title)),
    title: stripHtml(raw.title),
    authors: stripHtml(raw.authors),
    venue,
    year: Number(raw.year) || null,
    kind,
    status,
    presentation,
    url,
    isNew: Boolean(raw.new && raw.new.trim()),
  };
}

const publications = defineCollection({
  loader: () =>
    PUB_SOURCES.flatMap(({ file, kind }) => (readJson(file) as RawPub[]).map((p) => normalizePub(p, kind))),
  schema: z.object({
    title: z.string().min(5),
    authors: z.string().min(3),
    venue: z.string(),
    year: z.number().int().min(2015).max(2030).nullable(),
    kind: z.enum(["conference", "journal", "workshop", "manuscript"]),
    status: z.enum(["published", "under-review", "submitted", "in-preparation"]),
    presentation: z.enum(["oral", "poster"]).nullable(),
    url: z.string().nullable(),
    isNew: z.boolean(),
  }),
});

/* ---------------- projects + profile (agent-maintained data) ---------------- */
const projects = defineCollection({
  loader: () => readJson("data/projects.json") as Array<{ id: string }>,
  schema: z.object({
    title: z.string(),
    stack: z.array(z.string()),
    description: z.string().min(20).max(600),
    links: z.array(link),
    date: yearMonth,
    featured: z.boolean(),
    tags: z.array(z.string()),
    source: z.enum(["manual", "github", "huggingface"]),
    stars: z.number().int().nonnegative().optional(),
    updatedAt: z.string().optional(),
  }),
});

const profile = defineCollection({
  loader: () => [{ id: "me", ...(readJson("data/profile.json") as object) }],
  schema: z.object({
    name: z.string(),
    headline: z.string(),
    role: z.string(),
    summary: z.string(),
    email: z.email(),
    phone: z.string(),
    location: z.string(),
    links: z.record(z.string(), z.string().nullable()),
    stats: z.object({
      papers: z.number().int(),
      citations: z.string(),
      h_index: z.number().int(),
      source: z.string(),
      as_of: z.string(),
    }),
    documents: z.record(z.string(), z.string()),
    updated: z.string(),
  }),
});

/* ---------------- locked facts ---------------- */
/** Loads an array file; `order` keeps the file's order (collections are otherwise returned sorted by id). */
const fromArray = (file: string) => () =>
  (readJson(file) as Array<{ id: string }>).map((e, order) => ({ ...e, order }));
const order = z.number().int().nonnegative();

const experience = defineCollection({
  loader: fromArray("content/experience.json"),
  schema: z.object({ order,
    role: z.string(), org: z.string(), orgUrl: z.string().optional(), location: z.string(),
    start: yearMonth, end: yearMonth.nullable(), highlights: z.array(z.string()).min(1),
  }),
});

const education = defineCollection({
  loader: fromArray("content/education.json"),
  schema: z.object({ order,
    degree: z.string(), school: z.string(), schoolUrl: z.string().optional(), location: z.string(),
    start: yearMonth, end: yearMonth, expected: z.boolean(), gpa: z.string(),
    coursework: z.array(z.string()), note: z.string().optional(),
  }),
});

const people = defineCollection({
  loader: fromArray("content/people.json"),
  schema: z.object({ order,
    name: z.string(), role: z.string(), group: z.enum(["committee", "collaborator"]),
    photo: z.string().nullable(), links: z.array(link), note: z.string().nullable(),
  }),
});

const awards = defineCollection({
  loader: fromArray("content/awards.json"),
  schema: z.object({ order,
    title: z.string(), org: z.string(), year: z.number().int().nullable(),
    /** First year, for awards held over a range (shown as start–year). */
    startYear: z.number().int().optional(),
    category: z.enum(["research", "industry", "academic"]), detail: z.string().nullable(),
  }),
});

const certifications = defineCollection({
  loader: fromArray("content/certifications.json"),
  schema: z.object({ order, title: z.string(), issuer: z.string(), url: z.string().nullable() }),
});

const participations = defineCollection({
  loader: fromArray("content/participations.json"),
  schema: z.object({ order,
    title: z.string(), host: z.string(), location: z.string(), date: yearMonth,
    dateLabel: z.string(), url: z.string(), detail: z.string(),
  }),
});

const news = defineCollection({
  loader: fromArray("content/news.json"),
  schema: z.object({ order, date: yearMonth, text: z.string() }),
});

const skills = defineCollection({
  loader: () => (readJson("content/skills.json") as Array<{ group: string }>).map((g, order) => ({ id: slug(g.group), order, ...g })),
  schema: z.object({ order, group: z.string(), items: z.array(z.string()) }),
});

const research = defineCollection({
  loader: () => [{ id: "research", ...(readJson("content/research.json") as object) }],
  schema: z.object({
    dissertation: z.object({
      title: z.string(), advisor: z.string(), status: z.string(), summary: z.string(),
      scale: z.object({ domains: z.number(), benchmarks: z.number(), architectures: z.number() }),
      stages: z.array(z.object({
        id: z.string(), n: z.number().int(), name: z.string(), question: z.string(), methods: z.array(z.string()),
      })).length(5),
    }),
    thesis: z.object({ title: z.string(), advisor: z.string(), year: z.number(), summary: z.string(), links: z.array(link) }),
    themes: z.array(z.object({ title: z.string(), text: z.string() })),
  }),
});

const service = defineCollection({
  loader: () => [{ id: "service", ...(readJson("content/service.json") as object) }],
  schema: z.object({
    summary: z.string(),
    /** count is null while a reviewing cycle is still active (assignments not final). */
    conferences: z.array(z.object({
      name: z.string(), count: z.number().int().nullable(), url: z.string().nullable(), active: z.boolean().optional(),
    })),
    journals: z.array(z.object({ name: z.string(), count: z.number().int(), url: z.string().nullable() })),
  }),
});

export const collections = {
  publications, projects, profile, experience, education, people, awards,
  certifications, participations, news, skills, research, service,
};
