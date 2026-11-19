/**
 * Google Scholar: headline citation figures from the public profile page.
 *
 * Scholar has no API. Its robots.txt allows automated reads of profile pages (`Allow: /citations?user=`)
 * and disallows paging (`cstart=`), search and cited-by pages, so this makes exactly one request to the
 * profile (up to 100 papers on one page) and nothing else. On a CAPTCHA, an error or an unexpected page,
 * it keeps the previous figures and reports it; it never retries or works around a block.
 *
 * Writes data/scholar.json and the citation figures in data/profile.json.
 */
import { readJson, writeJson, today, UA } from "./lib.mjs";

const OUT = "data/scholar.json";
const PROFILE = "data/profile.json";

const decode = (s = "") =>
  s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&hellip;/g, "…").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/\s+/g, " ").trim();

/** Parses the profile page; returns null if it is not a profile page with figures. */
export function parseProfile(html) {
  const std = [...html.matchAll(/<td class="gsc_rsb_std">(\d*)<\/td>/g)].map((m) => Number(m[1] || 0));
  if (std.length < 6) return null;
  const since = html.match(/<th class="gsc_rsb_sth">Since (\d{4})<\/th>/)?.[1] ?? null;
  const works = html.split('<tr class="gsc_a_tr">').slice(1).map((row) => {
    const gray = [...row.matchAll(/<div class="gs_gray">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
    return {
      title: decode(row.match(/class="gsc_a_at"[^>]*>([\s\S]*?)<\/a>/)?.[1]),
      authors: decode(gray[0]),
      venue: decode((gray[1] ?? "").replace(/<span class="gs_oph">[\s\S]*?<\/span>/, "")),
      year: Number(row.match(/class="gsc_a_h[^"]*"[^>]*>(\d{4})</)?.[1]) || null,
      cited_by: Number(row.match(/class="gsc_a_ac[^"]*"[^>]*>(\d+)</)?.[1] ?? 0),
    };
  }).filter((w) => w.title);
  return {
    totals: { citations: std[0], citations_recent: std[1], h_index: std[2], h_recent: std[3], i10_index: std[4], i10_recent: std[5], recent_since: since ? Number(since) : null },
    works,
  };
}

/** "1,436" style figure for the site. */
const fmt = (n) => n.toLocaleString("en-US");

export async function run(ctx) {
  const { config, state, changes, review, dryRun } = ctx;
  const user = config.identity.scholar;
  const url = `https://scholar.google.com/citations?user=${user}&hl=en&pagesize=100&sortby=pubdate`;
  const prev = readJson(OUT, null);

  let html = "", status = 0;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(30000) });
    status = res.status;
    html = await res.text();
  } catch (e) {
    status = -1;
  }
  const parsed = status === 200 ? parseProfile(html) : null;
  if (!parsed) {
    const why = status === 200 ? (/captcha|unusual traffic/i.test(html) ? "a CAPTCHA" : "an unexpected page") : status === -1 ? "no response" : `HTTP ${status}`;
    state.scholar_failures = (state.scholar_failures ?? 0) + 1;
    review.push(`Google Scholar returned ${why} (${state.scholar_failures} week${state.scholar_failures > 1 ? "s" : ""} in a row); kept the figures from ${prev?.as_of ?? "the last update"}. Nothing else is tried. If this persists, update \`data/profile.json\` stats by hand.`);
    return;
  }
  state.scholar_failures = 0;

  const t = parsed.totals;
  // Sanity checks: totals cannot drop sharply, and the h-index cannot exceed the number of papers listed.
  if (prev && t.citations < prev.totals.citations * config.limits.min_citation_ratio) {
    review.push(`Google Scholar citations fell from ${prev.totals.citations} to ${t.citations}; kept the previous figures. Check the profile for merged or removed papers.`);
    return;
  }
  if (t.h_index > parsed.works.length || !parsed.works.length) {
    review.push(`Google Scholar page parsed inconsistently (h-index ${t.h_index}, ${parsed.works.length} papers); kept the previous figures.`);
    return;
  }

  const data = { source: "Google Scholar", source_url: `https://scholar.google.com/citations?user=${user}&hl=en`, as_of: today(), totals: t, works: parsed.works };
  if (!prev || prev.totals.citations !== t.citations || prev.totals.h_index !== t.h_index || prev.totals.i10_index !== t.i10_index) {
    changes.push(`Google Scholar: ${t.citations} citations (was ${prev?.totals.citations ?? "not tracked"}), h-index ${t.h_index}, i10-index ${t.i10_index}`);
  }
  if (dryRun) return;
  // Only rewrite the snapshot when something other than the date moved, so quiet weeks make no commit.
  const same = prev && JSON.stringify({ ...prev, as_of: 0 }) === JSON.stringify({ ...data, as_of: 0 });
  if (!same) writeJson(OUT, data);

  const profile = readJson(PROFILE);
  const stats = { ...profile.stats, citations: fmt(t.citations), h_index: t.h_index, source: "Google Scholar", as_of: today().slice(0, 7) };
  if (stats.citations !== profile.stats.citations || stats.h_index !== profile.stats.h_index) {
    profile.stats = stats;
    writeJson(PROFILE, profile);
  }
}
