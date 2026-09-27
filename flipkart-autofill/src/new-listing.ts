/**
 * new-listing.ts — open a brand-new Flipkart listing and put its images in. Never sends it to QC.
 *
 * Measured on Vansh's account, 2026-09-27, by recording him do it once (WW-261):
 *
 *  - `#dashboard/addListings/single?vertical=decoration` opens on a brand box: type the brand, press
 *    **Check Brand**, then **Continue**. That creates the draft (`napi/createProductV2/create`) and the
 *    address gains `requestId=REQ…` — the draft's id, and how a half-done listing is found again.
 *  - The form opens under a **"A new way to add your variants!"** popup with its own Continue.
 *  - **Image addition (0/5)** is five tiles, Front View first. The big panel shows the chosen tile; an
 *    empty one holds `input#upload-image` (`.jpg, .png`, one file). Choosing a file uploads it at once
 *    (`napi/scf/uploadImage` → `contentValidationResult.valid`), the input disappears, and moving to
 *    another tab saves the draft ("Changes saved!", `Image addition (1/5)`).
 *
 * **Not yet seen: tiles 2–5.** The recording uploaded one image. Clicking the next tile to bring the
 * upload box back is the assumption here, so every image is checked twice — Flipkart's own `valid`
 * reply, then the tab's count — and the run stops, naming the tile, the moment either disagrees.
 */

import type { Page } from "playwright";

export const NEW_LISTING_URL = "https://seller.flipkart.com/index.html#dashboard/addListings/single?vertical=decoration";

/** Flipkart's own limits for this form, as it states them. */
export const MAX_IMAGES = 5;
const ACCEPTS = /\.(jpe?g|png)$/i;

/** `Image addition (3/5)` → 3. Null when the tab is not on the page. */
export function imageCount(tabText: string): number | null {
  const m = /Image addition\s*\((\d+)\s*\/\s*\d+\)/i.exec(tabText);
  return m ? Number(m[1]) : null;
}

/** The draft's id from the form's address, which is what finds it again. */
export const draftId = (url: string): string | null => /[?&]requestId=([A-Z0-9]+)/i.exec(url)?.[1] ?? null;

/** What is wrong with this set of files before anything is uploaded, or null. */
export function imagesProblem(files: string[]): string | null {
  if (!files.length) return "No images to upload.";
  if (files.length > MAX_IMAGES) return `Flipkart takes ${MAX_IMAGES} images; ${files.length} were given.`;
  const bad = files.filter((f) => !ACCEPTS.test(f));
  return bad.length ? `Flipkart takes only .jpg and .png: ${bad.join(", ")}` : null;
}

/** Dismiss the variants popup if it is up. Absent is fine — Flipkart shows it once per something. */
async function closeVariantsPopup(page: Page): Promise<void> {
  const popup = page.getByText("A new way to add your variants!");
  if (await popup.isVisible({ timeout: 4000 }).catch(() => false)) {
    await page.getByRole("button", { name: "Continue", exact: true }).last().click({ timeout: 5000 }).catch(() => {});
  }
}

/**
 * Start a new decoration listing under `brand` and wait for the form. Returns the draft's id.
 *
 * Throws with Flipkart's words when the brand is refused, rather than carrying on into a page that is
 * not the form.
 */
export async function openNewListing(page: Page, brand: string): Promise<string> {
  await page.goto(NEW_LISTING_URL, { waitUntil: "domcontentloaded" });
  const box = page.getByPlaceholder("Enter Brand Name");
  await box.waitFor({ timeout: 30_000 });
  await box.fill(brand);
  await page.getByRole("button", { name: "Check Brand" }).click();
  const go = page.getByRole("button", { name: "Continue", exact: true });
  await go.waitFor({ timeout: 20_000 }).catch(async () => {
    const said = (await page.locator("main, body").first().innerText().catch(() => "")).slice(0, 300);
    throw new Error(`Flipkart did not offer Continue for brand "${brand}". The page says: ${said}`);
  });
  await go.click();
  await page.waitForURL(/requestId=/, { timeout: 30_000 });
  await page.getByText(/Image addition \(/).first().waitFor({ timeout: 30_000 });
  await closeVariantsPopup(page);
  return draftId(page.url())!;
}

export interface UploadRow {
  file: string;
  tile: number;
  ok: boolean;
  /** Flipkart's reason when it refused the image, or ours when the page did not behave as recorded. */
  why?: string;
}

/**
 * Put `files` into the image tiles in order — `files[0]` is the Front View. Stops at the first failure.
 *
 * Each upload waits for Flipkart's own answer to it, so "uploaded" means Flipkart said valid, not that
 * a file was handed to an input. Then it moves to the Price tab, which is what saves the draft, and reads
 * the count back.
 */
export async function uploadImages(page: Page, files: string[], onRow?: (r: UploadRow) => void): Promise<UploadRow[]> {
  const problem = imagesProblem(files);
  if (problem) throw new Error(problem);
  await closeVariantsPopup(page);
  await page.getByText(/Image addition \(/).first().click();

  const rows: UploadRow[] = [];
  for (const [i, file] of files.entries()) {
    const row: UploadRow = { file, tile: i + 1, ok: false };
    rows.push(row);
    try {
      // Tile 1 is already chosen when the tab opens; later ones have to be picked to get an upload box.
      if (i > 0) await page.locator("text=/^Image$/").nth(i - 1).click({ timeout: 10_000 });
      const input = page.locator("input#upload-image");
      await input.waitFor({ state: "attached", timeout: 10_000 });
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/napi/scf/uploadImage"), { timeout: 90_000 }),
        input.setInputFiles(file),
      ]);
      const body = await res.json().catch(() => null);
      const verdict = body?.contentValidationResult;
      if (!verdict?.valid) {
        row.why = `Flipkart refused it: ${JSON.stringify(verdict?.contentValidationErrors ?? body ?? res.status())}`;
      } else row.ok = true;
    } catch (err) {
      row.why = `Tile ${i + 1} did not behave as recorded: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
    }
    onRow?.(row);
    if (!row.ok) return rows;
  }

  // Leaving the tab is what saves; the count on it is the proof.
  await page.getByText(/Price, Stock and Shipping/).first().click();
  await page.waitForTimeout(3000);
  const count = imageCount(await page.getByText(/Image addition \(/).first().innerText().catch(() => ""));
  if (count !== files.length) {
    rows.push({ file: "", tile: 0, ok: false, why: `The tab reads ${count ?? "nothing"} of ${MAX_IMAGES} after ${files.length} uploads.` });
  }
  return rows;
}
