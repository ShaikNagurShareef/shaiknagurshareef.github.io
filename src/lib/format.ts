const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-04" -> "Apr 2026", "2026" -> "2026" */
export function ym(value: string | null | undefined): string {
  if (!value) return "Present";
  const [y, m] = value.split("-");
  return m ? `${MONTHS[Number(m) - 1]} ${y}` : y;
}

export function range(start: string, end: string | null, expected = false): string {
  return `${ym(start)} – ${end ? ym(end) + (expected ? " (expected)" : "") : "Present"}`;
}

export const STATUS_LABEL: Record<string, string> = {
  published: "Published",
  "under-review": "Under review",
  submitted: "Submitted",
  "in-preparation": "In preparation",
};

export const KIND_LABEL: Record<string, string> = {
  conference: "Conference",
  journal: "Journal",
  workshop: "Workshop",
  manuscript: "Manuscript",
};

/** Sort by year desc, then orals first. */
export function byRecency<T extends { data: { year: number | null; presentation: string | null } }>(a: T, b: T) {
  return (b.data.year ?? 0) - (a.data.year ?? 0) || Number(b.data.presentation === "oral") - Number(a.data.presentation === "oral");
}
