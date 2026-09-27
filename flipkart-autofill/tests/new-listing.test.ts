/** new-listing.test.ts — the parts of the Flipkart image upload that do not need a browser. */

import { describe, expect, it } from "vitest";
import { draftId, imageCount, imagesProblem } from "../src/new-listing.js";

describe("new listing", () => {
  it("reads the image tab's count as the recording showed it", () => {
    expect(imageCount("Image addition\n(1/5)")).toBe(1);
    expect(imageCount("Image addition (0/5)")).toBe(0);
    expect(imageCount("Price, Stock and Shipping Information (0/21)")).toBeNull();
  });

  it("takes the draft id from the form's address", () => {
    expect(draftId("https://seller.flipkart.com/index.html#dashboard/addListings/single?brand=PartyDreams&vertical=decoration&requestId=REQQN6TLXHHK9NIKEX&context=CPUI")).toBe("REQQN6TLXHHK9NIKEX");
    expect(draftId("https://seller.flipkart.com/index.html#dashboard/addListings/single?vertical=decoration")).toBeNull();
  });

  it("refuses a set Flipkart would refuse, before anything is uploaded", () => {
    expect(imagesProblem(["1.jpg", "2.png"])).toBeNull();
    expect(imagesProblem([])).toMatch(/No images/);
    expect(imagesProblem(["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg", "6.jpg"])).toMatch(/takes 5/);
    expect(imagesProblem(["1.webp"])).toMatch(/only .jpg and .png/);
  });
});
