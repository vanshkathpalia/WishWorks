/**
 * Stock.test.tsx — the Raw stock screen must actually render.
 *
 * This is the screen Vansh uses on a delivery day, and it took five new pieces in one session: the
 * "or one we already have" picker, the teach prompt, the taught-words list, the fortnight forecast
 * and the ChatGPT ask. **The Latch tab came up blank after a change like that** while typecheck,
 * the renderer build and every engine test passed — nothing here renders a component, so a fault in
 * the JSX has nothing standing in its way.
 *
 * `renderToString` is enough and needs no DOM: a crash while building the tree is exactly what this
 * catches. Effects do not run, so the bridge stub only has to exist.
 */

// `import React` because this repo's vitest config uses the classic JSX transform; the renderer
// itself is built by vite with the automatic one and needs no such import.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { Forecast, Stock } from "./Stock.js";

/** Every bridge call the screen makes. Present, and never resolving, is enough to render. */
const bridge = {
  stock: () => new Promise(() => {}),
  tallyNotes: () => new Promise(() => {}),
  saveDelivery: () => new Promise(() => {}),
  removeDelivery: () => new Promise(() => {}),
  setAlias: () => new Promise(() => {}),
  addMaterial: () => new Promise(() => {}),
  editMaterial: () => new Promise(() => {}),
  learnWord: () => new Promise(() => {}),
  learnedWords: () => new Promise(() => {}),
  proposeWord: () => new Promise(() => {}),
  askSupplierWords: () => new Promise(() => {}),
  applySupplierWords: () => new Promise(() => {}),
};

describe("the Raw stock screen", () => {
  it("renders before anything has loaded", () => {
    // The state every launch passes through, and the one most likely to hit an undefined.
    vi.stubGlobal("window", { ww: bridge, localStorage: { getItem: () => null, setItem: () => {} } });
    expect(() => renderToString(<Stock n={0} />)).not.toThrow();
  });
});

/**
 * The fortnight panel, with real-shaped data. The empty screen above is the easy case; this is the
 * one that maps over nested arrays, and a missing field there is a blank tab rather than a bad
 * number.
 */
describe("the fortnight's requirement", () => {
  const need = [
    {
      key: "Fringes|Red Fringes",
      name: "Red Fringes",
      pieces: 600,
      packs: 12,
      perPack: 50,
      from: [{ sku: "ANP1", perDay: 10, perKit: 4, pieces: 600 }],
    },
    // The row whose pack size nobody knows: `packs` is null and the panel must not do arithmetic
    // on it. This is the shape that would have crashed a naive `n.packs.toString()`.
    { key: "Net|Pink Net", name: "Pink Net", pieces: 30, packs: null, perPack: null, from: [] },
  ];

  it("renders both a counted row and one with no pack size", () => {
    expect(() => renderToString(<Forecast need={need} days={14} window={28} />)).not.toThrow();
  });

  it("shows the packet count where there is one, and a dash where there is not", () => {
    // `renderToString` puts `<!-- -->` between a value and the text beside it, so `{600} pcs`
    // arrives as `600<!-- --> pcs`. Stripped here; it is a quirk of rendering to a string, not of
    // the screen.
    const html = renderToString(<Forecast need={need} days={14} window={28} />).replace(/<!--.*?-->/g, "");
    expect(html).toContain("12 pkt");
    expect(html).toContain("— pkt");
    expect(html).toContain("600 pcs");
  });

  it("says on the screen that it does not subtract the shelf", () => {
    // The one caveat that must never be lost in a redesign: it is a GROSS requirement, so it can
    // only over-order, and a reader who misses that will double-buy.
    expect(renderToString(<Forecast need={need} days={14} window={28} />)).toContain(
      "does not subtract what you already",
    );
  });

  it("renders nothing at all when there is nothing to order", () => {
    expect(renderToString(<Forecast need={[]} days={14} window={28} />)).toBe("");
  });
});
