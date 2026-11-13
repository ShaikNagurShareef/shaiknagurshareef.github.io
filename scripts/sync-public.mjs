// Copies the repo-root data/ and img/ folders into public/ before every build.
// data/ stays the single source of truth (the agent and the legacy site both read it),
// and every existing URL such as /data/NagurShareefShaik_Resume.pdf keeps working.
import { cpSync, rmSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Guard: the dissertation PDF must not be published before it is released.
const doc = JSON.parse(readFileSync(join(root, "content/research.json"), "utf8")).dissertation.document;
if (doc && !doc.released && existsSync(join(root, doc.path.replace(/^\//, "")))) {
  console.error(`Refusing to build: ${doc.path} exists but content/research.json says it is not released yet.`);
  console.error("Move it to private/ or run scripts/release_dissertation.py.");
  process.exit(1);
}
for (const dir of ["data", "img"]) {
  const src = join(root, dir);
  const dest = join(root, "public", dir);
  if (!existsSync(src)) continue;
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true, filter: (p) => !p.endsWith(".DS_Store") });
}
console.log("synced data/ and img/ into public/");
