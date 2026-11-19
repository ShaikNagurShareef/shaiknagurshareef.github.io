/**
 * Site search: query understanding and lexical ranking for the Ctrl/Cmd+K palette.
 *
 * Pure functions with no imports and no DOM access, so the same code runs in the browser and in
 * Node tests. The palette ranks with BM25 instantly, then (optionally) fuses in the semantic
 * ranking from the portfolio API with reciprocal rank fusion (see `fuse`).
 */

export type ItemType =
  | "Page" | "Section" | "Publication" | "Project" | "Person" | "Document" | "Profile"
  | "Award" | "Experience" | "Education" | "Certification" | "Action";

export interface SearchItem {
  type: ItemType;
  title: string;
  subtitle?: string;
  /** Unique key; the semantic API returns results keyed by this. */
  url: string;
  external?: boolean;
  /** Short extra terms for lexical matching. */
  keywords?: string;
  /** Natural description used for retrieval (embedded by the semantic API). */
  text?: string;
  /** First (or only) year the item belongs to; `yearEnd` closes a range, `current` leaves it open. */
  year?: number;
  yearEnd?: number;
  current?: boolean;
  /** Publications only. */
  kind?: string;
  status?: string;
  oral?: boolean;
}

export type FilterKey = "type" | "year" | "oral" | "kind" | "status";

export interface Filters {
  types: ItemType[];
  yearMin?: number;
  yearMax?: number;
  oral?: boolean;
  kind?: "journal" | "conference" | "workshop";
  status?: "review" | "published" | "in-preparation";
}

export interface Concept {
  /** The token as typed (normalised). */
  token: string;
  /** Alternatives with weights: the token itself, typo corrections, prefix completions, synonyms. */
  alts: Array<[string, number]>;
}

export interface ParsedQuery {
  raw: string;
  concepts: Concept[];
  filters: Filters;
  /** True when every typed word was a type word (e.g. "papers", "awards"). */
  intentOnly: boolean;
  question: boolean;
}

/* ------------------------------------------------------------------ text processing */

const STOP = new Set(
  ("a an and are as at be been being but by can could did do does doing for from had has have he her his how i if in into is it its " +
   "me my mine of on or our ours she so than that the their them then there these they this those to too was we were what when where " +
   "which who whom whose why will with would you your about any all also some show list find tell give get see want know more most " +
   "please there here him done did using use used just only other others over under up very via vs shareef shareefs nagur shaik " +
   "has have having any thing things something anything ever")
    .split(/\s+/),
);

/** Phrases folded into a single token on both sides (documents and queries). */
const PHRASES: Array<[RegExp, string]> = [
  [/\bx[\s-]?rays?\b/g, " xray "],
  [/\b(?:text|nl|natural[\s-]language)[\s-]?(?:to|2)[\s-]?sql\b/g, " nl2sql "],
  [/\b(?:large\s+)?(?:language|lang)\s+models?\b/g, " llm "],
  [/\bvision[\s-]+language\b/g, " vlm "],
  [/\bretrieval[\s-]+augmented(?:\s+generation)?\b/g, " rag "],
  [/\breport\s+generation\b/g, " report generation rrg "],
  [/\bradiology\s+reports?\b/g, " radiology report rrg "],
  [/\bmulti[\s-]+modal(ity|ities)?\b/g, " multimodal "],
  [/\bmulti[\s-]+agents?\b/g, " multiagent "],
  [/\bhugging\s*face\b/g, " huggingface "],
  [/\bmagnetic\s+resonance(?:\s+imaging)?\b/g, " mri "],
  [/\bcomputed\s+tomography\b/g, " ct "],
  [/\bdeep\s+learning\b/g, " deep learning dl "],
];

export function normalize(s: string): string {
  let t = s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  for (const [re, rep] of PHRASES) t = t.replace(re, rep);
  return t;
}

/** Light suffix stripping, applied identically to documents and queries. */
export function stem(w: string): string {
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.endsWith("ing") && w.length > 6) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 5) return w.slice(0, -2);
  return w;
}

const rawTokens = (normalized: string) => normalized.split(/[^a-z0-9]+/).filter(Boolean);

export function tokenize(s: string): string[] {
  return rawTokens(normalize(s)).map(stem);
}

/* ------------------------------------------------------------------ vocabulary of the domain */

/** Groups of interchangeable terms: any member expands to all others. */
const GROUPS: string[][] = [
  ["xray", "cxr", "radiograph", "radiography", "chest"],
  ["mri", "fmri", "neuroimaging", "brain", "neuro"],
  ["ct", "tomography"],
  ["llm", "gpt", "gemini", "chatgpt"],
  ["vlm", "multimodal"],
  ["rag", "retrieval", "grounded", "grounding"],
  ["retina", "retinal", "retinopathy", "fundus", "oculomics", "ophthalmic", "ophthalmology", "eye", "diabetic"],
  ["nl2sql", "sql", "text2sql", "bird"],
  ["agent", "agentic", "multiagent", "langgraph"],
  ["tumor", "tumour", "glioma", "glioblastoma", "oncology", "cancer"],
  ["rrg", "report", "radiology", "reporting"],
  ["award", "prize", "honor", "honour", "grant", "medal", "champion", "winner", "scholarship", "recognition"],
  ["job", "role", "work", "experience", "position", "employment", "career"],
  ["classification", "classify", "classifier", "grading", "diagnosis"],
  ["segmentation", "segment"],
  ["demo", "live"],
  ["advisor", "adviser", "supervisor", "mentor", "chair"],
  ["explainable", "interpretable", "interpretability", "xai", "explainability"],
  ["alzheimer", "dementia"],
  ["disentangle", "disentangled", "disentanglement"],
  ["longitudinal", "temporal"],
];
/** One-way expansions (the key expands, the targets do not expand back). */
const ONE_WAY: Record<string, string[]> = {
  dr: ["retinopathy", "retinal", "diabetic", "fundus"],
  ai: ["artificial", "intelligence"],
  ml: ["machine", "learning"],
  nlp: ["language", "llm"],
};

const SYN = new Map<string, Set<string>>();
for (const g of GROUPS) {
  const stems = g.map(stem);
  for (const s of stems) {
    const set = SYN.get(s) ?? new Set<string>();
    for (const o of stems) if (o !== s) set.add(o);
    SYN.set(s, set);
  }
}
for (const [k, v] of Object.entries(ONE_WAY)) {
  const set = SYN.get(stem(k)) ?? new Set<string>();
  for (const o of v) set.add(stem(o));
  SYN.set(stem(k), set);
}

/** Words that state what kind of result is wanted. `keep` words also stay as search terms. */
const INTENT: Record<string, { type: ItemType; keep?: boolean }> = {};
const intent = (words: string, type: ItemType, keep = false) => {
  for (const w of words.split(" ")) INTENT[stem(w)] = { type, keep };
};
intent("paper papers publication publications article articles presentation presentations talk talks", "Publication");
intent("project projects app apps tool tools", "Project");
intent("demo demos", "Project", true);
intent("award awards honor honors honour honours prize prizes", "Award");
intent("grant grants medal medals scholarship scholarships", "Award", true);
intent("job jobs role roles work experience experiences position positions employment career", "Experience");
intent("education degree degrees", "Education");
intent("people person persons", "Person");
intent("advisor advisors adviser supervisor supervisors committee collaborator collaborators coauthor coauthors mentor mentors", "Person", true);
intent("certificate certificates certification certifications", "Certification");
intent("resume cv pdf document documents", "Document");

/** Page or section that lists everything of a type; shown first when the query is only a type word. */
export const TYPE_HOME: Partial<Record<ItemType, string>> = {
  Publication: "/publications/",
  Project: "/projects/",
  Award: "/recognition/",
  Experience: "/experience/",
  Education: "/experience/#edu-h",
  Person: "/research/#committee-h",
  Certification: "/service/#certs-h",
  Document: "/cv/",
};

export const TYPE_PLURAL: Record<ItemType, string> = {
  Page: "Pages", Section: "Sections", Publication: "Publications", Project: "Projects", Person: "People",
  Document: "Documents", Profile: "Profiles", Award: "Awards", Experience: "Experience", Education: "Education",
  Certification: "Certifications", Action: "Actions",
};

/* ------------------------------------------------------------------ query parsing */

const QUESTION_START = /^(who|what|which|how|why|when|where|does|do|did|is|are|was|were|has|have|can|could|should|would|will|list|show|tell|give|explain|describe|summari[sz]e)\b/i;

export function isQuestion(q: string): boolean {
  const t = q.trim();
  if (!t) return false;
  return t.endsWith("?") || QUESTION_START.test(t) || t.split(/\s+/).length >= 4;
}

const YEAR = "((?:19|20)\\d{2})";

export function parseQuery(q: string, now: Date = new Date()): Omit<ParsedQuery, "concepts"> & { tokens: string[]; partial: string | null } {
  const filters: Filters = { types: [] };
  const thisYear = now.getFullYear();
  let s = " " + q.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "") + " ";
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      fn(m);
      s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
      re.lastIndex = 0;
    }
  };
  const setMin = (y: number) => { filters.yearMin = Math.max(filters.yearMin ?? -Infinity, y); };
  const setMax = (y: number) => { filters.yearMax = Math.min(filters.yearMax ?? Infinity, y); };

  // Years and ranges.
  take(new RegExp(`\\b(?:from|between)?\\s*${YEAR}\\s*(?:-|–|—|to|and|through|until)\\s*${YEAR}\\b`), (m) => {
    const a = Number(m[1]), b = Number(m[2]);
    setMin(Math.min(a, b)); setMax(Math.max(a, b));
  });
  take(new RegExp(`\\b(since|after|from|post)\\s+${YEAR}\\b`), (m) => setMin(Number(m[2]) + (m[1] === "after" ? 1 : 0)));
  take(new RegExp(`\\b(before|until|till|prior to|pre)\\s+${YEAR}\\b`), (m) => setMax(Number(m[2]) - (m[1] === "until" || m[1] === "till" ? 0 : 1)));
  take(/\b(?:in\s+|during\s+)?this\s+year\b/, () => { setMin(thisYear); setMax(thisYear); });
  take(/\b(?:in\s+|during\s+)?last\s+year\b/, () => { setMin(thisYear - 1); setMax(thisYear - 1); });
  take(new RegExp(`\\b(?:in|during|of|from)?\\s*${YEAR}\\b`), (m) => { setMin(Number(m[1])); setMax(Number(m[1])); });

  // Publication status, presentation and venue kind.
  take(/\b(?:under|in)\s+(?:review|submission)\b|\bsubmitted\b|\bunder\s+consideration\b/, () => { filters.status = "review"; });
  take(/\bin\s+preparation\b/, () => { filters.status = "in-preparation"; });
  take(/\bpublished\b/, () => { filters.status ??= "published"; });
  take(/\borals?\b(?:\s+presentations?|\s+talks?|\s+papers?)?/, () => { filters.oral = true; });
  take(/\bjournals?\b/, () => { filters.kind = "journal"; });
  take(/\bconferences?\b/, () => { filters.kind = "conference"; });
  take(/\bworkshops?\b/, () => { filters.kind = "workshop"; });

  const partial = /\s$/.test(q) ? null : (rawTokens(normalize(q)).pop() ?? null);
  const tokens: string[] = [];
  let intentWords = 0;
  for (const t of rawTokens(normalize(s))) {
    const st = stem(t);
    const it = INTENT[st];
    if (it) {
      intentWords++;
      if (!filters.types.includes(it.type)) filters.types.push(it.type);
      if (it.keep) tokens.push(st);
      continue;
    }
    if (STOP.has(t) || STOP.has(st)) continue;
    tokens.push(st);
  }
  // A publication-only filter implies publications.
  if ((filters.oral || filters.kind || filters.status) && !filters.types.length) filters.types.push("Publication");
  return {
    raw: q,
    tokens,
    partial: partial && tokens.length && stem(partial) === tokens[tokens.length - 1] ? partial : null,
    filters,
    intentOnly: intentWords > 0 && tokens.length === 0,
    question: isQuestion(q),
  };
}

/** Human-readable filter labels, e.g. ["Publications", "2025 or later", "Oral"]. */
export function filterLabels(f: Filters): Array<{ key: FilterKey; label: string }> {
  const out: Array<{ key: FilterKey; label: string }> = [];
  const pubOnly = f.types.length === 1 && f.types[0] === "Publication";
  if (f.types.length && !(pubOnly && (f.kind || f.status === "review"))) {
    out.push({ key: "type", label: f.types.map((t) => TYPE_PLURAL[t]).join(" or ") });
  }
  if (f.kind) out.push({ key: "kind", label: `${f.kind[0].toUpperCase()}${f.kind.slice(1)} papers` });
  if (f.status) out.push({ key: "status", label: f.status === "review" ? "Under review" : f.status === "published" ? "Published" : "In preparation" });
  if (f.oral) out.push({ key: "oral", label: "Oral" });
  const lo = f.yearMin, hi = f.yearMax;
  if (lo != null || hi != null) {
    const label =
      lo != null && hi != null ? (lo === hi ? String(lo) : `${lo}–${hi}`)
      : lo != null ? `${lo} or later` : `${hi} or earlier`;
    out.push({ key: "year", label });
  }
  return out;
}

export function withoutFilters(f: Filters, off: Set<FilterKey>): Filters {
  return {
    types: off.has("type") ? [] : f.types,
    yearMin: off.has("year") ? undefined : f.yearMin,
    yearMax: off.has("year") ? undefined : f.yearMax,
    oral: off.has("oral") ? undefined : f.oral,
    kind: off.has("kind") ? undefined : f.kind,
    status: off.has("status") ? undefined : f.status,
  };
}

export function passes(item: SearchItem, f: Filters, thisYear = new Date().getFullYear()): boolean {
  if (f.types.length && !f.types.includes(item.type)) return false;
  if (f.yearMin != null || f.yearMax != null) {
    if (item.year == null) return false;
    const end = item.yearEnd ?? (item.current ? thisYear : item.year);
    if (f.yearMin != null && end < f.yearMin) return false;
    if (f.yearMax != null && item.year > f.yearMax) return false;
  }
  if (f.oral && !item.oral) return false;
  if (f.kind && item.kind !== f.kind) return false;
  if (f.status === "review" && !(item.status === "under-review" || item.status === "submitted")) return false;
  if (f.status && f.status !== "review" && item.status !== f.status) return false;
  return true;
}

export const hasFilters = (f: Filters) =>
  f.types.length > 0 || f.yearMin != null || f.yearMax != null || !!f.oral || !!f.kind || !!f.status;

/* ------------------------------------------------------------------ index + BM25 */

type Field = Map<string, number>;
interface Doc { item: SearchItem; fields: [Field, Field, Field]; lens: [number, number, number] }

export interface Index {
  docs: Doc[];
  byUrl: Map<string, SearchItem>;
  df: Map<string, number>;
  avg: [number, number, number];
  vocab: string[];
}

/** Field weights: title > subtitle and keywords > description. */
const WEIGHTS = [3, 1.5, 1] as const;
const K1 = 1.2, B = 0.75;

function counts(tokens: string[]): Field {
  const m: Field = new Map();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

export function buildIndex(items: SearchItem[]): Index {
  const df = new Map<string, number>();
  const sums = [0, 0, 0];
  const docs: Doc[] = items.map((item) => {
    const toks = [
      tokenize(item.title),
      tokenize(`${item.subtitle ?? ""} ${item.keywords ?? ""}`),
      tokenize(item.text ?? ""),
    ];
    const fields = toks.map(counts) as Doc["fields"];
    const seen = new Set<string>();
    for (const f of fields) for (const t of f.keys()) seen.add(t);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
    toks.forEach((t, i) => (sums[i] += t.length));
    return { item, fields, lens: [toks[0].length, toks[1].length, toks[2].length] };
  });
  const n = Math.max(docs.length, 1);
  return {
    docs,
    byUrl: new Map(items.map((i) => [i.url, i])),
    df,
    avg: [sums[0] / n || 1, sums[1] / n || 1, sums[2] / n || 1],
    vocab: [...df.keys()],
  };
}

/** Damerau-Levenshtein distance capped at 2 (enough for "edit distance 1" checks). */
function within1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // transposition
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1); // deletion / insertion
}

/** Expand tokens into weighted alternatives: synonyms, typo corrections, prefix completions. */
export function concepts(index: Index, tokens: string[], partial: string | null): Concept[] {
  return tokens.map((tok, i) => {
    const alts = new Map<string, number>([[tok, 1]]);
    const add = (t: string, w: number) => { if ((alts.get(t) ?? 0) < w) alts.set(t, w); };
    const known = index.df.has(tok);
    if (!known && tok.length >= 5) {
      for (const v of index.vocab) if (within1(tok, v)) add(v, 0.85);
    }
    if (i === tokens.length - 1 && partial && partial.length >= 2) {
      let n = 0;
      for (const v of index.vocab) {
        if (v !== tok && v.startsWith(partial)) { add(v, 0.9); if (++n >= 40) break; }
      }
    }
    for (const base of [...alts.keys()]) {
      for (const s of SYN.get(base) ?? []) add(s, 0.6 * (alts.get(base) ?? 1));
    }
    return { token: tok, alts: [...alts] };
  });
}

export interface Ranked { item: SearchItem; score: number }

function bm25(index: Index, doc: Doc, c: Concept, N: number): number {
  let best = 0;
  for (const [t, w] of c.alts) {
    const df = index.df.get(t);
    if (!df) continue;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    let s = 0;
    for (let f = 0; f < 3; f++) {
      const tf = doc.fields[f].get(t);
      if (!tf) continue;
      const norm = 1 - B + B * (doc.lens[f] / index.avg[f]);
      s += WEIGHTS[f] * ((tf * (K1 + 1)) / (tf + K1 * norm));
    }
    best = Math.max(best, w * idf * s);
  }
  return best;
}

/** Newest first by start year; ongoing roles before ended ones that started the same year. */
const sortKey = (i: SearchItem) => (i.year ?? 0) + (i.current ? 0.5 : 0);

/**
 * Lexical ranking. Returns the items passing the filters, best first.
 * With no content words (e.g. "awards in 2025") it lists everything that passes, newest first.
 */
export interface LexicalResult {
  parsed: ParsedQuery;
  /** The filters actually applied (parsed filters minus `off`). */
  filters: Filters;
  /** Filters switched off, by the caller or because a type word matched nothing of that type. */
  off: Set<FilterKey>;
  results: Ranked[];
}

export function lexicalSearch(index: Index, q: string, opts: { now?: Date; off?: Set<FilterKey>; limit?: number } = {}): LexicalResult {
  const now = opts.now ?? new Date();
  const thisYear = now.getFullYear();
  const p = parseQuery(q, now);
  const off = opts.off ?? new Set<FilterKey>();
  const filters = withoutFilters(p.filters, off);
  const cs = concepts(index, p.tokens, p.partial);
  const N = index.docs.length;
  let ranked: Ranked[] = [];

  if (cs.length) {
    const qNorm = rawTokens(normalize(q)).join(" ");
    for (const doc of index.docs) {
      if (!passes(doc.item, filters, thisYear)) continue;
      let score = 0, hit = 0;
      for (const c of cs) {
        const s = bm25(index, doc, c, N);
        if (s > 0) { score += s; hit++; }
      }
      if (!hit) continue;
      score *= 0.4 + 0.6 * (hit / cs.length); // reward matching more of the query
      const title = rawTokens(normalize(doc.item.title)).join(" ");
      if (qNorm.length > 2 && title.startsWith(qNorm)) score *= 1.5;
      ranked.push({ item: doc.item, score });
    }
    ranked.sort((a, b) => b.score - a.score);
    // A type word that matches nothing of that type ("work on brain tumors") is read as plain text.
    if (!ranked.length && filters.types.length && !off.has("type")) {
      return lexicalSearch(index, q, { ...opts, off: new Set([...off, "type"]) });
    }
  } else if (hasFilters(filters)) {
    ranked = index.docs
      .filter((d) => passes(d.item, filters, thisYear))
      .map((d) => ({ item: d.item, score: 0 }))
      .sort((a, b) => sortKey(b.item) - sortKey(a.item));
    // A bare type word ("papers", "awards"): the page that lists them comes first.
    if (p.intentOnly && filters.types.length === 1 && !filters.yearMin && !filters.yearMax && !filters.oral && !filters.kind && !filters.status) {
      const home = index.byUrl.get(TYPE_HOME[filters.types[0]] ?? "");
      if (home) ranked.unshift({ item: home, score: 1 });
    }
  }
  return { parsed: { ...p, concepts: cs }, filters, off, results: ranked.slice(0, opts.limit ?? 60) };
}

/* ------------------------------------------------------------------ semantic fusion */

export interface SemanticHit { url: string; score: number }

/**
 * Reciprocal rank fusion of the lexical list and the semantic list (k = 60); the parsed filters apply
 * to everything. Items only the semantic ranking found are kept when their similarity clears `floor`
 * and is within `margin` of the best hit: bge-small similarities are compressed (unrelated items
 * often score 0.55-0.65), so closeness to the top separates matches better than a fixed floor.
 */
export function fuse(
  index: Index,
  lexical: SearchItem[],
  semantic: SemanticHit[],
  filters: Filters,
  opts: { floor?: number; margin?: number; k?: number; now?: Date; limit?: number } = {},
): SearchItem[] {
  const k = opts.k ?? 60;
  const top = semantic.reduce((m, h) => Math.max(m, h.score), 0);
  const margin = opts.margin ?? (lexical.length ? 0.06 : 0.1);
  const min = Math.max(opts.floor ?? 0.55, top - margin);
  const thisYear = (opts.now ?? new Date()).getFullYear();
  const score = new Map<string, number>();
  const items = new Map<string, SearchItem>();
  lexical.forEach((it, r) => { score.set(it.url, 1 / (k + r + 1)); items.set(it.url, it); });
  let r = 0;
  for (const h of semantic) {
    const it = index.byUrl.get(h.url);
    if (!it || !passes(it, filters, thisYear)) continue;
    r++;
    if (!items.has(h.url)) {
      if (h.score < min) continue;
      items.set(h.url, it);
    }
    score.set(h.url, (score.get(h.url) ?? 0) + 1 / (k + r));
  }
  return [...items.values()]
    .sort((a, b) => score.get(b.url)! - score.get(a.url)!)
    .slice(0, opts.limit ?? 60);
}
