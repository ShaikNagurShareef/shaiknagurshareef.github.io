import type { APIRoute } from "astro";
import { getPublications } from "../lib/pubs";

/** All publications as one BibTeX file, generated at build time. */
export const GET: APIRoute = async () => {
  const pubs = await getPublications();
  const header = `% Nagur Shareef Shaik, publications (${pubs.length} entries)\n% Generated from https://shaiknagurshareef.github.io/publications/\n\n`;
  return new Response(header + pubs.map((p) => p.bibtex).join("\n\n") + "\n", {
    headers: { "Content-Type": "application/x-bibtex; charset=utf-8" },
  });
};
