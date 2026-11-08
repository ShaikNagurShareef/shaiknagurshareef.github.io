#!/usr/bin/env python3
"""Build portfolio-chat-api/knowledge.md, the single knowledge file the chat agent loads.

Sources (all relative to the repo root):
  - data/NagurShareefShaik_ResearchResume.pdf
  - data/NagurShareefShaik_ResearchStatement.pdf
  - data/{conferences,journals,workshops,under-review}.json
  - data/profile.json + content/experience.json (CURRENT PROFILE; newer than the PDFs)
  - content/awards.json (honors, with years)
  - content/service.json (peer review, including active reviewing roles)
  - selected <section> blocks of index.html

Run from anywhere:  python3 portfolio-chat-api/build_knowledge.py
Requires: pypdf  (build-time only; the API itself does not need it)
"""
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "knowledge.md"
SITE = "https://shaiknagurshareef.github.io"

PDFS = [
    ("RESEARCH RESUME", ROOT / "data/NagurShareefShaik_ResearchResume.pdf"),
    ("RESEARCH STATEMENT", ROOT / "data/NagurShareefShaik_ResearchStatement.pdf"),
]
PUB_FILES = [
    ("Conference papers", "conferences.json"),
    ("Journal papers", "journals.json"),
    ("Workshop papers", "workshops.json"),
    ("Under review", "under-review.json"),
]
SECTIONS = [
    "about", "education", "experience", "skills", "projects", "certifications",
    "interests", "participations", "team",
]


def strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text or "")
    return re.sub(r"\s+", " ", text).strip()


def pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join((p.extract_text() or "").strip() for p in reader.pages).strip()


class SectionExtractor(HTMLParser):
    """Collect visible text and link targets of the <section id=...> blocks."""

    SKIP = {"script", "style", "noscript"}

    def __init__(self, wanted):
        super().__init__(convert_charrefs=True)
        self.wanted = set(wanted)
        self.current = None
        self.depth = 0
        self.skip = 0
        self.out = {}
        self.href = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "section" and a.get("id") in self.wanted and self.current is None:
            self.current, self.depth = a["id"], 1
            self.out[self.current] = []
            return
        if self.current is None:
            return
        if tag == "section":
            self.depth += 1
        if tag in self.SKIP:
            self.skip += 1
        if tag in {"p", "li", "div", "h1", "h2", "h3", "br", "tr"}:
            self.out[self.current].append("\n")
        if tag == "a":
            self.href = a.get("href")

    def handle_endtag(self, tag):
        if self.current is None:
            return
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        if tag == "a" and self.href:
            if self.href.startswith(("http", "mailto:")):
                self.out[self.current].append(f" ({self.href})")
            elif self.href.startswith("data/"):
                self.out[self.current].append(f" ({SITE}/{self.href})")
            self.href = None
        if tag == "section":
            self.depth -= 1
            if self.depth == 0:
                self.current = None

    def handle_data(self, data):
        if self.current is not None and not self.skip:
            self.out[self.current].append(data)


def tidy(chunks) -> str:
    text = "".join(chunks)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    lines = [ln.strip() for ln in text.split("\n")]
    text = "\n".join(ln for ln in lines if ln)
    return text


def publications() -> str:
    parts = []
    for label, name in PUB_FILES:
        items = json.loads((ROOT / "data" / name).read_text())
        parts.append(f"### {label} ({len(items)})")
        for it in items:
            parts.append(
                f"- \"{strip_html(it.get('title'))}\" — {strip_html(it.get('authors'))}. "
                f"{strip_html(it.get('medium'))}, {it.get('year', '')}. Link: {it.get('url', '')}"
            )
        parts.append("")
    return "\n".join(parts).strip()


def current_profile() -> str:
    """Summary and roles from the site's structured data, which is updated more often than the PDFs."""
    me = json.loads((ROOT / "data/profile.json").read_text())
    lines = [
        f"(Updated {me['updated']}. Where this differs from the PDFs below, this is current.)", "",
        f"Current title: {me['title']}, {me['titleOrg']}. (His UST role is listed as Machine Learning Engineer II in the experience history.)",
        f"Also: {me['role']}.", "", me["summary"], "",
    ]
    for j in json.loads((ROOT / "content/experience.json").read_text()):
        end = j["end"] or "present"
        lines.append(f"- {j['role']}, {j['org']} ({j['start']} to {end}): " + " ".join(j["highlights"]))
    return "\n".join(lines)


def awards() -> str:
    """Honors from content/awards.json, the same source the website renders."""
    lines = []
    for a in json.loads((ROOT / "content/awards.json").read_text()):
        year = a.get("year")
        span = f"{a['startYear']}–{year}" if a.get("startYear") and year else (str(year) if year else "")
        line = f"- {a['title']}, {a['org']}" + (f" ({span})" if span else "")
        if a.get("detail"):
            line += f". {a['detail']}"
        lines.append(line)
    return "\n".join(lines)


def service() -> str:
    """Peer review from content/service.json, the same source the website renders."""
    d = json.loads((ROOT / "content/service.json").read_text())
    active = [c["name"] for c in d["conferences"] if c.get("active")]
    done = [f"{c['name']} ({c['count']} papers)" for c in d["conferences"] if c.get("count") is not None]
    journals = [f"{j['name']} ({j['count']})" for j in d["journals"]]
    lines = [d["summary"]]
    if active:
        lines.append("Currently an active reviewer for: " + ", ".join(active) + ".")
    lines.append("Completed conference reviewing: " + "; ".join(done) + ".")
    lines.append("Journal reviewing (papers reviewed): " + "; ".join(journals) + ".")
    return "\n".join(lines)


def main() -> int:
    blocks = ["# Knowledge base: Nagur Shareef Shaik", ""]
    blocks += ["## CURRENT PROFILE", current_profile(), ""]
    for label, path in PDFS:
        if not path.exists():
            print(f"missing: {path}", file=sys.stderr)
            return 1
        blocks += [f"## {label}", pdf_text(path), ""]

    blocks += ["## PUBLICATIONS", publications(), ""]
    blocks += ["## HONORS AND AWARDS", awards(), ""]
    blocks += ["## PEER REVIEW AND SERVICE", service(), ""]

    html = (ROOT / "index.html").read_text()
    # Ignore commented-out markup so stale content never leaks into the knowledge base.
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    # Keep the home address out of the knowledge base (phone/email are public on the resume).
    html = re.sub(r"\d+ [A-Za-z ]+ (?:Pl|St|Ave|Rd|Blvd|Dr)\b[^·<]*·", "", html)
    ex = SectionExtractor(SECTIONS)
    ex.feed(html)
    blocks.append("## WEBSITE SECTIONS")
    for sec in SECTIONS:
        if sec in ex.out:
            blocks += [f"### {sec.upper()}", tidy(ex.out[sec]), ""]
        else:
            print(f"warning: section #{sec} not found", file=sys.stderr)

    OUT.write_text("\n".join(blocks).strip() + "\n")
    size = OUT.stat().st_size
    print(f"wrote {OUT.relative_to(ROOT)} ({size:,} bytes, ~{size // 4:,} tokens)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
