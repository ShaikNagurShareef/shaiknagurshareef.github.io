"""Deploy the portfolio chat API (portfolio-chat-api/) to its Hugging Face Space.

Usage (after `hf auth login` with a write token):
    python3 scripts/deploy_space.py            # upload code + set the Gemini key secret
    python3 scripts/deploy_space.py --code-only

The Gemini key is read from the local, gitignored .env (GOOGLE_API_KEY or GEMINI_API_KEY) and sent
straight to the Space's secret store. It is never printed or written anywhere else.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from huggingface_hub import HfApi

SPACE = "nagur-shareef-shaik/portfolio-chat-api"
ROOT = Path(__file__).resolve().parent.parent
APP_DIR = ROOT / "portfolio-chat-api"
FILES = ["app.py", "knowledge.md", "requirements.txt", "Dockerfile", "build_knowledge.py"]


def read_key() -> str | None:
    env = ROOT / ".env"
    if not env.exists():
        return None
    for line in env.read_text().splitlines():
        name, _, value = line.partition("=")
        if name.strip() in ("GOOGLE_API_KEY", "GEMINI_API_KEY") and value.strip():
            return value.strip().strip('"').strip("'")
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--code-only", action="store_true", help="skip setting the secret")
    args = parser.parse_args()

    api = HfApi()
    user = api.whoami()["name"]
    print(f"Logged in as {user}; deploying to {SPACE}")

    missing = [f for f in FILES if not (APP_DIR / f).exists()]
    if missing:
        print(f"Missing files in {APP_DIR}: {missing}", file=sys.stderr)
        return 1

    if not args.code_only:
        key = read_key()
        if not key:
            print("No GOOGLE_API_KEY/GEMINI_API_KEY in .env; skipping the secret.", file=sys.stderr)
        else:
            api.add_space_secret(SPACE, "GOOGLE_API_KEY", key, description="Gemini API key (portfolio chat)")
            print("Space secret GOOGLE_API_KEY set.")

    commit = api.upload_folder(
        repo_id=SPACE,
        repo_type="space",
        folder_path=str(APP_DIR),
        allow_patterns=FILES,
        commit_message="Deploy rebuilt portfolio chat API (server-side knowledge, streaming, rate limits)",
    )
    print(f"Uploaded: {commit.commit_url}")
    print("The Space rebuilds now; check https://nagur-shareef-shaik-portfolio-chat-api.hf.space/health in a few minutes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
