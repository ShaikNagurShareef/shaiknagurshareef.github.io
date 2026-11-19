/** Shared helpers for the portfolio agent (scripts/agent/*). No dependencies beyond Node 22. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export const UA = "portfolio-agent/1.0 (+https://shaiknagurshareef.github.io)";

export const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
/** Writes in the repository's JSON style (2-space indent, UTF-8, trailing newline); returns true if the file changed. */
export function writeJson(path, data) {
  const next = JSON.stringify(data, null, 2) + "\n";
  if (existsSync(path) && readFileSync(path, "utf8") === next) return false;
  writeFileSync(path, next);
  return true;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET/POST with a timeout and a few retries on 429/5xx; returns the Response (callers check .ok). */
export async function http(url, { headers = {}, retries = 3, timeout = 30000, ...opts } = {}) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { ...opts, headers: { "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(timeout), redirect: "follow" });
    } catch (e) {
      if (attempt >= retries) throw e;
      await sleep(1500 * attempt);
      continue;
    }
    if (res.ok || attempt >= retries || (res.status < 500 && res.status !== 429)) return res;
    await sleep(1500 * attempt);
  }
}
export async function getJson(url, opts) {
  const res = await http(url, opts);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** Lower-case, accents and markup stripped, punctuation removed: for matching titles across sources. */
export const normTitle = (s = "") =>
  s.replace(/<[^>]+>/g, "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();

/** Similarity of two normalized titles (Dice coefficient on word bigrams), 0..1. */
export function titleSim(a, b) {
  const grams = (s) => { const w = s.split(" "); const g = new Map(); for (let i = 0; i < w.length - 1; i++) { const k = w[i] + " " + w[i + 1]; g.set(k, (g.get(k) ?? 0) + 1); } return g; };
  if (a === b) return 1;
  const A = grams(a), B = grams(b);
  let inter = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) ?? 0);
  return na + nb ? (2 * inter) / (na + nb) : 0;
}

export const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);
export const today = () => new Date().toISOString().slice(0, 10);
export const doiKey = (d) => (d ? d.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase() : null);
export const ARXIV_RE = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i;

/** Is a demo URL up? Any final status below 400 after redirects counts. */
export async function urlOk(url) {
  try {
    const res = await http(url, { retries: 2, timeout: 25000, headers: { Accept: "text/html,*/*" } });
    return res.status < 400;
  } catch {
    return false;
  }
}

/**
 * Optional Gemini call with a JSON schema (structured output). Returns the parsed object, or null when
 * no key is configured or the call fails; callers must work without it.
 */
export async function gemini(prompt, schema) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.AGENT_MODEL || "gemini-2.5-flash";
  try {
    const res = await http(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: "application/json", responseSchema: schema },
      }),
      timeout: 60000,
    });
    if (!res.ok) return null;
    const d = await res.json();
    return JSON.parse(d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "null");
  } catch {
    return null;
  }
}
