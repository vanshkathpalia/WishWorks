/**
 * chat.test.ts — picking the newly generated image out of a chat.
 *
 * The browser half cannot be unit-tested, but this can, and it is the part that silently ruins a
 * run: a chat already holds the photos uploaded to it and everything generated earlier in the same
 * conversation, so "the last image on the page" is not "the one I just asked for".
 */

import { describe, it, expect } from "vitest";
import { STANDARD_RUN, newImages } from "../src/chat-core.js";

const url = (id: string) => `https://chatgpt.com/backend-api/estuary/content?id=${id}&ts=1&p=fs&cid=1&sig=x`;

describe("finding the image that was just generated", () => {
  it("takes what was not there before", () => {
    expect(newImages([url("a")], [url("a"), url("b")])).toEqual([url("b")]);
  });

  it("ignores the pictures that were uploaded INTO the chat", () => {
    // The costing flow uploads a contents photo and then asks for images. The upload must never be
    // mistaken for the answer — it would be saved as the hero and nobody would notice until listing.
    const uploaded = [url("upload1"), url("upload2")];
    expect(newImages(uploaded, [...uploaded, url("generated")])).toEqual([url("generated")]);
  });

  it("survives the same chat producing a second and third image", () => {
    // The hero, the infographic and the sizes sheet share one chat on purpose — each prompt refers
    // to the one before. So every round has more history than the last.
    const afterHero = [url("hero")];
    const afterInfo = [...afterHero, url("info")];
    expect(newImages(afterHero, afterInfo)).toEqual([url("info")]);
    expect(newImages(afterInfo, [...afterInfo, url("sizes")])).toEqual([url("sizes")]);
  });

  it("is empty when nothing new arrived", () => {
    // What a timed-out generation looks like. The caller reports it rather than saving a stale image.
    expect(newImages([url("a")], [url("a")])).toEqual([]);
  });
});

/**
 * The standard run. The order and the numbering are not this file's to invent — `CLAUDE.md` and
 * `docs/guides/` already say which prompt comes when, and the rest of the tool already means
 * something by image 1, 2 and 3.
 */
describe("the four-prompt run", () => {
  it("reads the pack before making anything", () => {
    // `PROMPT-read-pack.md` says "in TEXT ONLY (do NOT make an image)", and its answer is what the
    // three image prompts are written against. First, and producing no picture.
    expect(STANDARD_RUN[0]).toEqual({ prompt: "PROMPT-read-pack.md", image: null });
  });

  it("numbers the images the way the rest of the tool does", () => {
    expect(STANDARD_RUN.filter((s) => s.image !== null).map((s) => [s.prompt, s.image])).toEqual([
      ["PROMPT-main-image.md", 1],
      ["PROMPT-infographic.md", 2],
      ["PROMPT-infographic-sizes.md", 3],
    ]);
  });

  it("expects exactly one text step", () => {
    // More than one would mean a prompt that makes no picture went unnoticed, and its step would
    // be reported as a missing image for ever.
    expect(STANDARD_RUN.filter((s) => s.image === null)).toHaveLength(1);
  });
});
