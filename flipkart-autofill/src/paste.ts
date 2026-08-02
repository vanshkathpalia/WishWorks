/**
 * paste.ts — print the four marketplace values with REAL line breaks, ready to copy.
 *
 * This file is the COMMAND LINE only: it reads argv, calls `runPaste()` in paste-core.ts, and
 * prints the result. Every check lives in the core so the app can run the same ones the moment a
 * reply lands, instead of only when somebody remembers to type this.
 *
 * JSON stores line breaks as \n, which no marketplace form accepts. The prompt used to work
 * around that by printing every value a second time as plain text ("section 3"), which doubled
 * the AI's output for no new information. JSON.parse already unescapes, so this does it here.
 *
 *   npm run paste -- ANP-1
 */

import path from "node:path";
import { PasteNotFound, runPaste } from "./paste-core.js";
import { showPath } from "./paths.js";

const id = process.argv[2];
if (!id) {
  console.error("usage: npm run paste -- <ID>");
  process.exit(1);
}

let result;
try {
  result = await runPaste(id);
} catch (e) {
  if (!(e instanceof PasteNotFound)) throw e;
  // The download arrives named `image-meta-<ID>.json` / `products-<ID>.json`; you may have filed
  // it as `<ID>.json`. findById treats all of those as the same product — see id.ts.
  console.error(`\nNothing in ${path.basename(e.dir)}/ matches "${e.id}".`);
  console.error(`  Save the download there under any of: ${e.id}.json, image-meta-${e.id}.json, products-${e.id}.json`);
  process.exit(1);
}

for (const half of result.halves) {
  if (!half.others.length) continue;
  console.error(
    `⚠️  ${half.others.length + 1} files answer to "${id}" — reading ${showPath(half.file)}, ` +
      `ignoring ${half.others.map((f) => path.basename(f)).join(", ")}`,
  );
}

for (const f of result.fields) {
  if (f.value === null) {
    console.log(`\n[${f.label}]  (missing)`);
    continue;
  }
  const note =
    f.status === "over" ? "  ⚠️ OVER — the form will cut it off"
    : f.status === "under" ? `  ⚠️ under the ${f.min} target`
    : "";
  console.log(`\n[${f.label}]  ${f.length}/${f.max}${note}\n${f.value}`);
}

// The four values above run to hundreds of lines in a terminal, so an inline ⚠️ on line 3 is gone
// by the time you have scrolled to the bottom to copy. Repeat everything that matters here,
// after the values, where the eye already is.
const { problems } = result;
if (problems.length) {
  console.log(`\n──────── ⚠️  ${problems.length} THING${problems.length === 1 ? "" : "S"} TO FIX ────────\n`);
  for (const p of problems) console.log(`  • ${p}\n`);
  console.log(`  Nothing is blocked — the values above are still correct to paste.\n`);
} else {
  console.log(`\n──────── ✅ nothing to fix — every value is present and within its limit ────────\n`);
}
