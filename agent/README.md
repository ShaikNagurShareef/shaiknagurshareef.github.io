# Portfolio agent

A weekly GitHub Action (Mondays, 07:23 UTC) (`.github/workflows/portfolio-agent.yml`) that keeps the research and
project sections of the site current. It runs `node scripts/agent/run.mjs`, validates the result
with a full site build, commits any changes to `main`, redeploys the site and, when the
`HF_SPACE_TOKEN` secret is set, the chat assistant's knowledge.

| What | Source | When | Applied automatically |
|---|---|---|---|
| Citing papers, per-paper counts, OpenAlex h-index | OpenAlex API (free, no key) | weekly | yes |
| Citations, h-index, i10 (headline figures) | Google Scholar public profile page | weekly | yes |
| New papers, under-review → published | OpenAlex + ORCID public API | weekly | only when verified (below) |
| Project stars, last update, renamed repos, missing demo links | GitHub API, Hugging Face API | weekly | yes |
| New GitHub projects with a runnable demo | GitHub API, Hugging Face API | weekly | only when verified (below) |
| Broken demos, demo-link mismatches, unverified items | all of the above | weekly | no: listed in the review issue |

## Rules

- **Google Scholar:** one request per week to the public profile page, which Scholar's robots.txt
  allows (`Allow: /citations?user=`). No paging, no search or cited-by pages, no retries. If Scholar
  answers with a CAPTCHA or an error, the previous figures stay and the review issue says so.
- **A paper is published automatically** only if OpenAlex lists it under the author ID above with
  the ORCID on the authorship, or the ORCID record lists it; it has a DOI; it is a journal,
  conference or book-chapter version (not a preprint); and it does not duplicate an existing entry.
  A match with an under-review entry moves that entry to the published list.
- **A project is added automatically** only if it is a public, non-fork repository owned by the
  account above, has a description, and has a demo (repository homepage, a same-name Hugging Face
  Space, or a demo link in the README) that responds.
- Hand-written text (descriptions, venues, curated demo links) is never overwritten; differences are
  reported instead. Nothing is deleted.
- Anything uncertain goes into one GitHub issue labelled `portfolio-agent`, updated each run and
  closed when nothing needs attention.

## Controls

- Pause: set `"enabled": false` in `agent/config.json`, or the repository variable
  `AGENT_ENABLED=false`.
- Skip something for good: add it to `ignore` in `agent/config.json` (OpenAlex work IDs, titles,
  repository or Space names).
- Run now: `gh workflow run portfolio-agent.yml` (add `-f scholar=true` to read Scholar too, or
  `-f dry_run=true` to report without committing).
- Undo: every change is its own commit by `portfolio-agent`; `git revert <sha>`.
- History: `agent/log.json` (one entry per run with changes).
