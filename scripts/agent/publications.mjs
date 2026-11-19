/**
 * Publications: finds papers that are not on the site yet and papers that moved from review to print.
 *
 * Sources (all free, no keys): OpenAlex (works by author ID), the ORCID public API (works on the ORCID
 * record) and Crossref (metadata for the entry: authors, venue, year, type).
 *
 * A paper is added automatically only when it is verified as mine (ORCID on the OpenAlex authorship, or
 * listed on the ORCID record), has a DOI, is a peer-reviewed type (journal article, proceedings paper,
 * book chapter) and does not duplicate an entry. Everything else goes to the review list.
 */
import { readJson, writeJson, getJson, normTitle, titleSim, doiKey, today, ARXIV_RE } from "./lib.mjs";

const LISTS = { conference: "data/conferences.json", journal: "data/journals.json", workshop: "data/workshops.json" };
const UNDER_REVIEW = "data/under-review.json";
const NEWS = "content/news.json";
const PROFILE = "data/profile.json";

const clean = (s = "") => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function openAlexWorks(author) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const d = await getJson(`https://api.openalex.org/works?filter=author.id:${author}&per-page=200&page=${page}&select=id,doi,title,publication_year,type,primary_location,locations,authorships`);
    out.push(...d.results);
    if (d.results.length < 200 || out.length >= d.meta.count) break;
  }
  return out;
}

async function orcidWorks(orcid) {
  const d = await getJson(`https://pub.orcid.org/v3.0/${orcid}/works`, { headers: { Accept: "application/json" } });
  return (d.group ?? []).map((g) => {
    const s = g["work-summary"]?.[0] ?? {};
    const ids = s["external-ids"]?.["external-id"] ?? [];
    const id = (t) => ids.find((x) => x["external-id-type"] === t)?.["external-id-value"] ?? null;
    return { title: s.title?.title?.value ?? "", doi: doiKey(id("doi")), arxiv: id("arxiv")?.replace(/^arxiv:/i, "") ?? null, type: s.type ?? null, year: Number(s["publication-date"]?.year?.value) || null };
  });
}

async function crossref(doi) {
  try {
    return (await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)).message;
  } catch {
    return null;
  }
}

/** Index of what the site already lists: DOIs, arXiv IDs and normalized titles. */
function siteIndex() {
  const entries = [];
  for (const [kind, file] of Object.entries({ ...LISTS, manuscript: UNDER_REVIEW })) {
    for (const p of readJson(file, [])) {
      entries.push({
        kind, file, raw: p,
        doi: doiKey(p.doi ?? (p.url?.includes("doi.org/") ? p.url : null)),
        arxiv: p.arxiv ?? p.url?.match(ARXIV_RE)?.[1] ?? null,
        title: normTitle(p.title),
      });
    }
  }
  return entries;
}

/** "Family, Given" list with my name in bold, the way the site's lists are written. */
function authorLine(authors, me) {
  return authors.map((a) => {
    const name = a.family ? `${a.family}${a.given ? ", " + a.given : ""}` : a.name ?? "";
    const isMe = (a.ORCID && a.ORCID.includes(me.orcid)) || (normTitle(a.family) === "shaik" && /nagur/i.test(a.given ?? ""));
    return isMe ? `<strong>Shaik, Nagur Shareef</strong>` : name;
  }).filter(Boolean).join("; ");
}

/** Builds a complete site entry from Crossref (falls back to OpenAlex fields). */
function buildEntry(cr, w, me, badge) {
  const kindOf = () => {
    const t = cr?.type ?? "";
    const venue = [...(cr?.["container-title"] ?? []), cr?.event?.name ?? ""].join(" ");
    if (t === "journal-article") return "journal";
    if (t === "proceedings-article" || t === "book-chapter") return /workshop/i.test(venue) ? "workshop" : "conference";
    const src = w?.primary_location?.source?.type;
    if (src === "journal" && w?.type === "article") return "journal";
    if (src === "conference") return /workshop/i.test(venue + (w?.primary_location?.source?.display_name ?? "")) ? "workshop" : "conference";
    return null;
  };
  const kind = kindOf();
  const venue = clean(cr?.["container-title"]?.[0] ?? w?.primary_location?.source?.display_name ?? "");
  const year = cr?.published?.["date-parts"]?.[0]?.[0] ?? cr?.issued?.["date-parts"]?.[0]?.[0] ?? w?.publication_year ?? null;
  const authors = cr?.author?.length
    ? authorLine(cr.author, me)
    : authorLine((w?.authorships ?? []).map((a) => { const parts = (a.author?.display_name ?? "").split(" "); return { family: parts.pop(), given: parts.join(" "), ORCID: a.author?.orcid }; }), me);
  const arxiv = (w?.locations ?? []).map((l) => l.landing_page_url?.match(ARXIV_RE)?.[1] ?? l.pdf_url?.match(ARXIV_RE)?.[1]).find(Boolean) ?? null;
  const doi = doiKey(cr?.DOI ?? w?.doi);
  const entry = { url: `https://doi.org/${doi}`, title: clean(cr?.title?.[0] ?? w?.title ?? ""), medium: venue, authors, year: String(year ?? ""), new: badge, doi };
  if (arxiv) entry.arxiv = arxiv;
  return { kind, entry, venue, year };
}

export async function run(ctx) {
  const { config, changes, review, dryRun } = ctx;
  const me = config.identity;
  const ignoreWorks = new Set(config.ignore.works);
  const ignoreTitles = new Set(config.ignore.titles.map(normTitle));

  const [oa, orcid] = await Promise.all([openAlexWorks(me.openalex), orcidWorks(me.orcid).catch(() => [])]);
  const orcidDois = new Set(orcid.map((w) => w.doi).filter(Boolean));
  const site = siteIndex();
  const badge = readJson(LISTS.conference, []).find((p) => p.new)?.new ?? "";

  const lists = Object.fromEntries(Object.entries(LISTS).map(([k, f]) => [k, readJson(f, [])]));
  let underReview = readJson(UNDER_REVIEW, []);
  const news = readJson(NEWS, []);
  const touched = new Set();
  let added = 0;

  // Candidates: OpenAlex works, plus ORCID works with a DOI that OpenAlex does not have under my ID.
  const oaDois = new Set(oa.map((w) => doiKey(w.doi)).filter(Boolean));
  const candidates = [
    ...oa.filter((w) => !ignoreWorks.has(w.id.replace("https://openalex.org/", ""))).map((w) => ({
      w, doi: doiKey(w.doi), title: normTitle(w.title ?? ""), year: w.publication_year,
      verified: w.authorships.some((a) => a.author?.id?.endsWith(me.openalex) && a.author?.orcid?.includes(me.orcid)) || orcidDois.has(doiKey(w.doi)),
    })),
    ...orcid.filter((o) => o.doi && !oaDois.has(o.doi)).map((o) => ({ w: null, doi: o.doi, title: normTitle(o.title), year: o.year, verified: true })),
  ];

  for (const c of candidates) {
    if (!c.title || ignoreTitles.has(c.title)) continue;
    if (c.w?.type === "dissertation" || c.w?.type === "paratext") continue;
    const byId = site.find((s) => (c.doi && s.doi === c.doi));
    if (byId) continue;
    const best = site.map((s) => ({ s, sim: titleSim(s.title, c.title) })).sort((a, b) => b.sim - a.sim)[0];
    const label = c.w?.title ?? c.title;

    // Already listed under the same title: fill a missing DOI on a published entry (version of record).
    if (best && best.sim >= 0.95 && best.s.kind !== "manuscript") {
      if (c.doi && !best.s.doi && c.verified && /^10\./.test(c.doi)) {
        const cr = await crossref(c.doi);
        if (cr && cr.type !== "posted-content") {
          best.s.raw.doi = c.doi;
          best.s.doi = c.doi;
          touched.add(best.s.kind);
          changes.push(`Added the DOI ${c.doi} to "${clean(best.s.raw.title)}"`);
        }
      }
      continue;
    }
    if (best && best.sim >= 0.85 && best.s.kind !== "manuscript") continue; // same paper, different wording

    const isPreprint = c.w?.type === "preprint" || c.w?.primary_location?.source?.type === "repository";
    if (!c.verified || !c.doi || isPreprint) {
      const why = !c.verified ? "not linked to the ORCID" : !c.doi ? "no DOI" : "preprint";
      const maybe = best && best.sim >= 0.6 ? ` (similar to "${clean(best.s.raw.title)}")` : "";
      review.push(`Paper found but not added (${why}): "${label}" (${c.year ?? "n.d."})${maybe}. Add it by hand, or ignore it in \`agent/config.json\`.`);
      continue;
    }
    if (added >= config.limits.max_new_papers_per_run) {
      review.push(`Paper deferred to next week (per-run limit): "${label}"`);
      continue;
    }

    const cr = await crossref(c.doi);
    if (cr?.type === "posted-content") continue;
    const { kind, entry, venue, year } = buildEntry(cr, c.w, me, badge);
    if (!kind || !entry.title || !venue || !year || !entry.authors.includes("<strong>")) {
      review.push(`Paper found but its metadata is incomplete, so it was not added: "${label}" (DOI ${c.doi}).`);
      continue;
    }

    // An under-review entry with this title moves to the published list (keeping its figure).
    const ur = best && best.s.kind === "manuscript" && best.sim >= 0.85 ? best.s.raw : null;
    if (ur) {
      if (ur.figure) entry.figure = ur.figure;
      underReview = underReview.filter((p) => p !== ur);
      touched.add("manuscript");
      changes.push(`Published: "${entry.title}" moved from under review to ${kind === "journal" ? "journal articles" : kind + " papers"} (${venue}, ${year})`);
    } else {
      if (best && best.s.kind === "manuscript" && best.sim >= 0.6) review.push(`"${entry.title}" was added as a new paper; it may be the published version of the under-review entry "${clean(best.s.raw.title)}". Remove that entry if so.`);
      changes.push(`New ${kind} paper: "${entry.title}" (${venue}, ${year})`);
    }
    lists[kind].unshift(entry);
    touched.add(kind);
    site.push({ kind, raw: entry, doi: entry.doi, arxiv: entry.arxiv ?? null, title: normTitle(entry.title) });
    news.unshift({ id: `pub-${entry.doi.replace(/[^a-z0-9]+/gi, "-").slice(-40)}`, date: today().slice(0, 7), text: `“${entry.title}” published in ${venue}.` });
    added++;
  }

  if (dryRun || !touched.size) return;
  for (const kind of touched) if (kind !== "manuscript") writeJson(LISTS[kind], lists[kind]);
  if (touched.has("manuscript")) writeJson(UNDER_REVIEW, underReview);
  if (added) {
    writeJson(NEWS, news);
    const profile = readJson(PROFILE);
    profile.stats.papers += added;
    writeJson(PROFILE, profile);
  }
}
