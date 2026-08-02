/**
 * check.ts — read the description back out of finished images, to confirm the ingestion worked.
 *
 * This file is the COMMAND LINE only: it parses flags, calls `runCheck()` in check-core.ts, and
 * prints the result. The app calls the same core, so this step is a button there rather than a
 * command the partner has no Node to run.
 *
 * Finder "Get Info" and Preview do NOT show EXIF ImageDescription on macOS, so there is no way
 * to eyeball it. This prints, for every JPEG in a folder, whether a description was embedded and
 * what it says — the answer to "did the metadata actually land?".
 *
 * Run:  npm run check                     reads ~/Downloads/wishworks-ready (the finish output)
 *       npm run check -- --in="<folder>"  read a different folder
 *       npm run check -- --in="<file.jpg>" read a single file
 */

import { homedir } from "node:os";
import path from "node:path";
import { CheckNotFound, runCheck } from "./check-core.js";

/** ~/x → /Users/you/x. */
function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(homedir(), p.slice(1)) : p;
}

async function main() {
  const inArg = process.argv.find((a) => a.startsWith("--in="));
  const target = expandHome(inArg ? inArg.slice("--in=".length) : path.join(homedir(), "Downloads", "wishworks-ready"));

  let result;
  try {
    result = await runCheck(target);
  } catch (err) {
    if (!(err instanceof CheckNotFound)) throw err;
    console.error(`\n✖ Not found: ${target}\n`);
    process.exit(1);
  }

  console.log(`\n  Checking ${target}\n`);

  if (result.rows.length === 0) {
    console.log(`  (no JPEGs here)`);
  }
  for (const r of result.rows) {
    const name = r.file.padEnd(16);
    if (r.error) console.log(`  ⚠️  ${name} could not read (${r.error})`);
    else if (r.description) console.log(`  ✅ ${name} ${r.description.slice(0, 100)}${r.description.length > 100 ? "…" : ""}`);
    else console.log(`  ✖  ${name} NO description embedded`);
  }
  console.log(`\n  ✅ = description embedded   ✖ = none (make image-meta/<ID>.json and re-run finish)\n`);
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}\n`);
  process.exit(1);
});
