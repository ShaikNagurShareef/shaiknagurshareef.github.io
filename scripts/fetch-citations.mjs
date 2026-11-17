#!/usr/bin/env node
/**
 * Fetches who cites my papers from OpenAlex (free, open, no API key) and writes data/citations.json.
 *
 *   node scripts/fetch-citations.mjs
 *
 * Google Scholar has no public API (and blocks automated access), so OpenAlex is the source for the
 * citing-paper list; its h-index is computed here from the same records. The deploy workflow runs
 * this before each build and keeps the committed snapshot if OpenAlex is unreachable.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const AUTHOR = "A5027212073"; // OpenAlex author id, matched to ORCID 0000-0002-2432-7409
/** OpenAlex works wrongly attributed to me (author disambiguation errors). */
const EXCLUDE = new Set(["W3118925514"]);
const OUT = "data/citations.json";
const API = "https://api.openalex.org";
const HEADERS = { "User-Agent": "portfolio-citations/1.0 (+https://shaiknagurshareef.github.io)" };
const MAX_AUTHORS = 4;

async function get(path) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API + path, { headers: HEADERS });
    if (res.ok) return res.json();
    if (attempt >= 4 || (res.status < 500 && res.status !== 429)) throw new Error(`${res.status} ${path}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

/** Every result of a filtered /works query, following the cursor. */
async function allWorks(filter, select) {
  const out = [];
  let cursor = "*";
  while (cursor) {
    const d = await get(`/works?filter=${filter}&per-page=200&cursor=${encodeURIComponent(cursor)}&select=${select}`);
    out.push(...d.results);
    cursor = d.results.length ? d.meta.next_cursor : null;
  }
  return out;
}

const clean = (s) => (s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const shortId = (id) => id.replace("https://openalex.org/", "");
const doiOf = (w) => (w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, "") : null);
const venueOf = (w) => clean(w.primary_location?.source?.display_name) || null;
const linkOf = (w) => (w.doi ? w.doi : w.primary_location?.landing_page_url ?? `https://openalex.org/${shortId(w.id)}`);

async function main() {
  const mine = (await allWorks(`author.id:${AUTHOR}`, "id,title,publication_year,cited_by_count,doi,type,primary_location"))
    .filter((w) => !EXCLUDE.has(shortId(w.id)));

  const citing = new Map();
  for (const w of mine.filter((x) => x.cited_by_count > 0)) {
    const id = shortId(w.id);
    const rows = await allWorks(`cites:${id}`, "id,title,publication_year,doi,type,authorships,primary_location");
    for (const c of rows) {
      const cid = shortId(c.id);
      let rec = citing.get(cid);
      if (!rec) {
        const names = c.authorships.map((a) => clean(a.author?.display_name)).filter(Boolean);
        rec = {
          id: cid,
          title: clean(c.title) || "(untitled)",
          year: c.publication_year ?? null,
          venue: venueOf(c),
          type: c.type ?? null,
          url: linkOf(c),
          authors: names.slice(0, MAX_AUTHORS),
          more: Math.max(0, names.length - MAX_AUTHORS),
          self: c.authorships.some((a) => a.author?.id && shortId(a.author.id) === AUTHOR),
          cites: [],
        };
        citing.set(cid, rec);
      }
      rec.cites.push(id);
    }
  }

  // Count citations per work from the fetched lists, so the totals match the list shown on the site.
  const counts = new Map();
  for (const c of citing.values()) for (const id of c.cites) counts.set(id, (counts.get(id) ?? 0) + 1);
  const works = mine
    .map((w) => ({
      id: shortId(w.id),
      title: clean(w.title),
      year: w.publication_year ?? null,
      venue: venueOf(w),
      doi: doiOf(w),
      url: linkOf(w),
      cited_by: counts.get(shortId(w.id)) ?? 0,
    }))
    .sort((a, b) => b.cited_by - a.cited_by || (b.year ?? 0) - (a.year ?? 0));

  const sorted = works.map((w) => w.cited_by);
  const h = sorted.filter((n, i) => n >= i + 1).length;
  const list = [...citing.values()].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title));
  const total = works.reduce((n, w) => n + w.cited_by, 0);

  if (!works.length || !list.length) throw new Error("OpenAlex returned no works or citations; keeping the existing snapshot");
  if (existsSync(OUT)) {
    const prev = JSON.parse(readFileSync(OUT, "utf8"));
    if (total < prev.totals.citations * 0.8) throw new Error(`Citation total fell from ${prev.totals.citations} to ${total}; keeping the existing snapshot`);
  }

  const data = {
    source: "OpenAlex",
    source_url: `https://openalex.org/authors/${AUTHOR}`,
    as_of: new Date().toISOString().slice(0, 10),
    totals: {
      citations: total,
      citing_works: list.length,
      h_index: h,
      i10_index: sorted.filter((n) => n >= 10).length,
      works: works.length,
      self_citations: list.filter((c) => c.self).reduce((n, c) => n + c.cites.length, 0),
    },
    works,
    citing: list,
  };
  writeFileSync(OUT, JSON.stringify(data) + "\n");
  console.log(`citations: ${total} from ${list.length} works; h-index ${h}; i10 ${data.totals.i10_index}; ${works.length} of my works`);
}

main().catch((e) => {
  console.error(`fetch-citations: ${e.message}`);
  process.exit(1);
});
