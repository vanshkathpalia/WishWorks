/**
 * Latch.test.tsx — the Latch screen must actually render.
 *
 * Written because it did not: the tab came up blank, and every other check in this repo passed —
 * typecheck, the renderer bundle build, and 494 engine tests. None of them render a component, so
 * a fault in the JSX itself had nothing standing in its way.
 *
 * `renderToString` is enough and needs no DOM: the crash is thrown while building the tree, which
 * is exactly what this does. Effects do not run, so the bridge stub only has to exist.
 *
 * It lives beside the component rather than in `tests/` because the engine's tsconfig has no `jsx`
 * — deliberately, since `npm run typecheck` is the proof the GUI work changed no engine behaviour.
 */

// `import React` because this repo's vitest config uses the classic JSX transform; the renderer
// itself is built by vite with the automatic one and needs no such import.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { Latch } from "./Latch.js";

const bridge = {
  latches: () => Promise.resolve({ packs: [], rows: [] }),
  onLatchRow: () => () => {},
  onCrawlRow: () => () => {},
  pathForFile: () => "",
  pick: () => Promise.resolve([]),
};

describe("the Latch screen", () => {
  it("renders from empty", () => {
    vi.stubGlobal("window", { ww: bridge });
    expect(() => renderToString(<Latch n={0} />)).not.toThrow();
  });
});
