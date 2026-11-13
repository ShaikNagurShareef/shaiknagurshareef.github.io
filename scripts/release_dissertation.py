"""Publish the Ph.D. dissertation PDF on the site (run only after the defense / when ready to share).

Before release the PDF lives in private/ (git-ignored; this repository is public, so anything
committed is world-readable). This script:
  1. copies private/NagurShareefShaik_PhD_Dissertation.pdf to data/dissertation/,
  2. marks it released in content/research.json (the Research page then links the PDF),
  3. removes the defense invitation: the /defense/ page, the calendar file, the site banner (it
     only renders while a defense is scheduled), the defense news item and the defense details,
  4. prints the git commands to publish.

Usage:
    python3 scripts/release_dissertation.py            # check and release
    python3 scripts/release_dissertation.py --dry-run  # check only
"""
from __future__ import annotations

import argparse
import datetime
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAME = "NagurShareefShaik_PhD_Dissertation.pdf"
NEWS = ROOT / "content" / "news.json"
DEFENSE_FILES = [ROOT / "src" / "pages" / "defense" / "index.astro", ROOT / "src" / "pages" / "defense.ics.ts"]
SRC = ROOT / "private" / NAME
DST = ROOT / "data" / "dissertation" / NAME
RESEARCH = ROOT / "content" / "research.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not SRC.exists():
        print(f"Put the final PDF at {SRC.relative_to(ROOT)} first.", file=sys.stderr)
        return 1
    head = SRC.read_bytes()[:5]
    if head != b"%PDF-":
        print(f"{SRC.name} is not a PDF.", file=sys.stderr)
        return 1
    size = SRC.stat().st_size / 1e6
    if size > 95:
        print(f"{SRC.name} is {size:.0f} MB; GitHub rejects files over 100 MB. Compress it first.", file=sys.stderr)
        return 1

    research = json.loads(RESEARCH.read_text())
    doc = research["dissertation"]["document"]
    print(f"PDF: {SRC.relative_to(ROOT)} ({size:.1f} MB) -> {DST.relative_to(ROOT)}")
    print(f"Currently released: {doc['released']}")
    if args.dry_run:
        return 0

    DST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SRC, DST)
    today = datetime.date.today()
    doc["released"] = True
    doc["releasedOn"] = today.isoformat()

    # Retire the defense invitation now that the dissertation is public.
    diss = research["dissertation"]
    defense = diss.pop("defense", None)
    if defense:
        held = datetime.date.fromisoformat(defense["start"][:10])
        diss["status"] = f"Defended {held.strftime('%B')} {held.day}, {held.year}"
    RESEARCH.write_text(json.dumps(research, indent=2, ensure_ascii=False) + "\n")

    news = [n for n in json.loads(NEWS.read_text()) if n["id"] != "phd-defense"]
    if not any(n["id"] == "phd-dissertation" for n in news):
        news.insert(0, {"id": "phd-dissertation", "date": today.strftime("%Y-%m"),
                        "text": "Ph.D. dissertation defended at Georgia State University; the full text is now available on the Research page."})
    NEWS.write_text(json.dumps(news, indent=2, ensure_ascii=False) + "\n")

    removed = []
    for f in DEFENSE_FILES:
        if f.exists():
            f.unlink()
            removed.append(str(f.relative_to(ROOT)))
    if (ROOT / "src/pages/defense").exists() and not any((ROOT / "src/pages/defense").iterdir()):
        (ROOT / "src/pages/defense").rmdir()

    print("Released. Defense invitation removed:", ", ".join(removed) or "(already gone)")
    print("Rebuild the assistant's knowledge and publish:")
    print("  python3 portfolio-chat-api/build_knowledge.py && python3 scripts/deploy_space.py --code-only")
    print(f'  git add -A "{DST.relative_to(ROOT)}" content src/pages portfolio-chat-api/knowledge.md && git commit -m "Release Ph.D. dissertation" && git push')
    return 0


if __name__ == "__main__":
    sys.exit(main())
