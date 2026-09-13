/**
 * ready.test.ts — the tidy-up moves somebody's product photos in bulk, which Finder will not undo.
 * So the rules are pinned here, using the exact filenames off Vansh's disk on 2026-09-13.
 */

import { describe, it, expect } from "vitest";
import { LIMBO, planTidy, themeOf } from "../src/ready-core.js";

describe("reading a theme off a filename", () => {
  it("takes the letters before the first separator", () => {
    expect(themeOf("HBD-01.1.jpg")).toBe("HBD");
    expect(themeOf("ANP-12-annaprasan-decoration-kit-red-colour-gold-colour-balloons-1.jpg")).toBe("ANP");
  });

  it("is null when the name carries no theme at all", () => {
    // `02.1.jpg` is the real case. Null is the honest answer: a guess here files a photo under the
    // wrong product, and nothing downstream would ever question it.
    expect(themeOf("02.1.jpg")).toBeNull();
    expect(themeOf("2026-09-13.png")).toBeNull();
  });
});

describe("tidying wishworks-ready", () => {
  const folders = ["ANP", "DORE", "GTB", "HAL", "HBD", "JUNGLE", "PEPPA", "SPACE", "WB"];
  const subThemes = { "HBD-T": ["DORE", "JUNGLE", "PEPPA", "SPACE", "BABYBOSS", "KITTI", "SONIC"] };

  it("files a loose photo by the theme in its name", () => {
    const p = planTidy({ looseFiles: ["HBD-01.1.jpg"], folders });
    expect(p.moves).toEqual([{ from: "HBD-01.1.jpg", to: "HBD/HBD-01.1.jpg", why: "its name says HBD" }]);
  });

  it("parks a photo it cannot place, without renaming it", () => {
    const p = planTidy({ looseFiles: ["02.1.jpg"], folders });
    expect(p.stuck).toHaveLength(1);
    expect(p.moves[0].to).toBe(`${LIMBO}/02.1.jpg`);
  });

  it("puts the HBD-T themes under HBD-T", () => {
    const p = planTidy({ looseFiles: [], folders, subThemes });
    expect(p.moves.map((m) => `${m.from} -> ${m.to}`).sort()).toEqual([
      "DORE -> HBD-T/DORE",
      "JUNGLE -> HBD-T/JUNGLE",
      "PEPPA -> HBD-T/PEPPA",
      "SPACE -> HBD-T/SPACE",
    ]);
  });

  it("sends a loose DORE photo to its nested home, not the top level", () => {
    const p = planTidy({ looseFiles: ["DORE-3-x-1.jpg"], folders, subThemes });
    expect(p.moves[0].to).toBe("HBD-T/DORE/DORE-3-x-1.jpg");
  });

  it("never overwrites a photo that is already there", () => {
    // The one outcome that loses work. It is reported and skipped, never resolved by renaming.
    const p = planTidy({
      looseFiles: ["HBD-01.1.jpg"],
      folders,
      existing: { HBD: ["HBD-01.1.jpg"] },
    });
    expect(p.moves).toEqual([]);
    expect(p.clashes).toHaveLength(1);
  });

  it("leaves a theme that is already where it belongs alone", () => {
    expect(planTidy({ looseFiles: [], folders: ["ANP", "HBD"], subThemes }).moves).toEqual([]);
  });
});
