/** Profile networks: label and icon (simple-icons brand, or a lucide icon where no brand mark exists). */
export const PROFILE: Record<string, { label: string; brand?: string; icon?: string }> = {
  scholar: { label: "Google Scholar", brand: "googlescholar" },
  orcid: { label: "ORCID", brand: "orcid" },
  openreview: { label: "OpenReview", icon: "message-square-quote" },
  github: { label: "GitHub", brand: "github" },
  linkedin: { label: "LinkedIn", brand: "linkedin" },
  huggingface: { label: "Hugging Face", brand: "huggingface" },
  researchgate: { label: "ResearchGate", brand: "researchgate" },
  webofscience: { label: "Web of Science", icon: "book-open" },
  kaggle: { label: "Kaggle", icon: "database" },
  medium: { label: "Medium", brand: "medium" },
};
