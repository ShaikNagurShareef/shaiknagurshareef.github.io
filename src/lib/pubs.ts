import { getCollection, type CollectionEntry } from "astro:content";
import { byRecency } from "./format";
import { citationKeys, toBibtex } from "./bibtex";

export type Pub = CollectionEntry<"publications"> & { key: string; bibtex: string };

/** All publications in a canonical order (recency, orals first, then title) with stable BibTeX keys. */
export async function getPublications(): Promise<Pub[]> {
  const pubs = (await getCollection("publications")).sort(
    (a, b) => byRecency(a, b) || a.data.title.localeCompare(b.data.title),
  );
  const keys = citationKeys(pubs.map((p) => p.data));
  return pubs.map((p, i) => ({ ...p, key: keys[i], bibtex: toBibtex(p.data, keys[i]) }));
}
