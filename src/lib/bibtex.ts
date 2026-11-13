/** BibTeX generation for the publications collection (build time only). */

export interface PubData {
  title: string;
  authors: string; // "Last, First; Last, First"
  venue: string;
  year: number | null;
  kind: string;
  status: string;
  url: string | null;
  links?: { doi: string | null; arxiv: string | null };
}

const STOP = new Set(["a", "an", "the", "on", "of", "for", "and", "in", "to", "with", "via", "towards", "toward"]);

const ascii = (s: string) => s.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
/** Escape characters BibTeX treats specially; keep it readable. */
const esc = (s: string) => s.replace(/([&%$#_])/g, "\\$1").replace(/²/g, "$^2$");

function baseKey(p: PubData): string {
  const first = p.authors.split(";")[0]?.split(",")[0]?.trim() ?? "anon";
  const word = ascii(p.title).toLowerCase().split(/[^a-z0-9]+/).find((w) => w && !STOP.has(w)) ?? "paper";
  return `${ascii(first).toLowerCase().replace(/[^a-z]/g, "")}${p.year ?? "nd"}${word}`;
}

/** Stable, unique citation keys for a list of publications (suffix a, b, ... on collisions). */
export function citationKeys(pubs: PubData[]): string[] {
  const seen = new Map<string, number>();
  return pubs.map((p) => {
    const k = baseKey(p);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n === 0 ? k : `${k}${String.fromCharCode(97 + n)}`;
  });
}

export function toBibtex(p: PubData, key: string): string {
  const authors = p.authors.split(";").map((a) => a.trim()).filter(Boolean).join(" and ");
  const type = p.status !== "published" ? "unpublished" : p.kind === "journal" ? "article" : "inproceedings";
  const venueField = type === "article" ? "journal" : type === "inproceedings" ? "booktitle" : "note";
  const fields: Array<[string, string | null]> = [
    ["title", `{${esc(p.title)}}`],
    ["author", esc(authors)],
    [venueField, esc(p.venue)],
    ["year", p.year ? String(p.year) : null],
    ["doi", p.links?.doi ?? null],
    ["eprint", p.links?.arxiv?.split("/abs/")[1] ?? null],
    ["archivePrefix", p.links?.arxiv ? "arXiv" : null],
    ["url", p.url && /^https?:/.test(p.url) ? p.url : null],
  ];
  const body = fields
    .filter((f): f is [string, string] => Boolean(f[1]))
    .map(([k, v]) => `  ${k.padEnd(9)} = {${v}}`)
    .join(",\n");
  return `@${type}{${key},\n${body}\n}`;
}
