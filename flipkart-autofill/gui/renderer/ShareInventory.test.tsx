/**
 * ShareInventory.test.tsx — the Settings buttons render, before anything has been pressed.
 */

// `import React` because this repo's vitest config uses the classic JSX transform.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { ShareInventory } from "./ShareInventory.js";

describe("Share inventory, in Settings", () => {
  it("renders both buttons and says what is and is not shared", () => {
    vi.stubGlobal("window", { ww: { exportInventory: () => new Promise(() => {}), importInventory: () => new Promise(() => {}) } });
    const html = renderToString(<ShareInventory />);
    expect(html).toContain("Export inventory…");
    expect(html).toContain("Import inventory…");
    expect(html).toContain("Deliveries and stock are not included");
    vi.unstubAllGlobals();
  });
});
