#!/usr/bin/env node
/**
 * Portfolio agent: one weekly pass that brings research and projects up to date (see agent/README.md).
 *
 *   node scripts/agent/run.mjs              # apply changes to the data files
 *   node scripts/agent/run.mjs --dry-run    # report only
 *   node scripts/agent/run.mjs --only=projects,publications
 *   node scripts/agent/run.mjs --no-scholar
 *
 * Writes agent/state.json and agent/log.json, and the review list to $AGENT_REPORT (Markdown) for the
 * workflow's review issue. Each step is isolated: a failing source is reported and the rest still run.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { readJson, writeJson, today } from "./lib.mjs";
import * as scholar from "./scholar.mjs";
import * as publications from "./publications.mjs";
import * as projects from "./projects.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || process.env.DRY_RUN === "true";
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const wantScholar = !args.includes("--no-scholar") && process.env.SCHOLAR !== "false";
const want = (name) => !only || only.includes(name);

const config = readJson("agent/config.json");
if (!config.enabled || process.env.AGENT_ENABLED === "false") {
  console.log("Portfolio agent is paused (agent/config.json or AGENT_ENABLED).");
  process.exit(0);
}
const state = readJson("agent/state.json", {});
const ctx = { config, state, changes: [], review: [], dryRun };

async function step(name, fn) {
  if (!want(name)) return;
  const before = ctx.changes.length;
  try {
    await fn();
    console.log(`✓ ${name}: ${ctx.changes.length - before} change(s)`);
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    ctx.review.push(`The ${name} step failed this week (${e.message}); its data was left as it was.`);
  }
}

await step("citations", async () => {
  if (dryRun) return;
  const prev = readJson("data/citations.json", null)?.totals;
  execFileSync("node", ["scripts/fetch-citations.mjs"], { stdio: "inherit" });
  const t = readJson("data/citations.json").totals;
  if (!prev || prev.citations !== t.citations || prev.h_index !== t.h_index) {
    ctx.changes.push(`OpenAlex: ${t.citations} citations from ${t.citing_works} citing papers (was ${prev?.citations ?? "not tracked"}), h-index ${t.h_index}`);
  }
});
if (wantScholar) await step("scholar", () => scholar.run(ctx));
await step("publications", () => publications.run(ctx));
await step("projects", () => projects.run(ctx));

state.last_run = today();
if (!dryRun) {
  writeJson("agent/state.json", state);
  if (ctx.changes.length) {
    const log = readJson("agent/log.json", []);
    log.unshift({ date: today(), changes: ctx.changes });
    writeJson("agent/log.json", log.slice(0, 200));
  }
}

const md = [
  `## Portfolio agent, ${today()}${dryRun ? " (dry run)" : ""}`,
  "",
  "### Applied",
  ...(ctx.changes.length ? ctx.changes.map((c) => `- ${c}`) : ["- Nothing changed this week."]),
  "",
  "### Needs your review",
  ...(ctx.review.length ? ctx.review.map((r) => `- [ ] ${r}`) : ["- Nothing."]),
  "",
].join("\n");
console.log("\n" + md);
if (process.env.AGENT_REPORT) writeFileSync(process.env.AGENT_REPORT, md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changes=${ctx.changes.length}\nreview=${ctx.review.length}\n`);
