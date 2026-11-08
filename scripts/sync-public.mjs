// Copies the repo-root data/ and img/ folders into public/ before every build.
// data/ stays the single source of truth (the agent and the legacy site both read it),
// and every existing URL such as /data/NagurShareefShaik_Resume.pdf keeps working.
import { cpSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const dir of ["data", "img"]) {
  const src = join(root, dir);
  const dest = join(root, "public", dir);
  if (!existsSync(src)) continue;
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true, filter: (p) => !p.endsWith(".DS_Store") });
}
console.log("synced data/ and img/ into public/");
