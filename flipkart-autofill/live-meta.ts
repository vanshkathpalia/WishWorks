// live-meta.ts — one real meta + product chat for HBD-kitty01. Scratch; deleted after.
import { readFile } from "node:fs/promises";
import { runMetaChat, chatTitle } from "./src/chat-core.js";
import { openChatBrowser } from "./src/connect.js";

const dir = "images/1-raw/HBD-kitty01";
const s = await openChatBrowser();
const page = await s.context.newPage();
await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.screenshot({ path: "/private/tmp/claude-501/-Users-vansh-Coding-Side-projects--new-ideas--WishWorks/a95e2cf9-7474-4bdc-b92d-32685748bc35/scratchpad/start.png" });
const r = await runMetaChat(page, {
  images: [1, 2, 3, 4].map((n) => `${dir}/${n}.png`),
  kit: { sku: "HBD-Kitty01", json: await readFile("inventory/HBD-Kitty01.json", "utf8") },
  readPrompt: (n) => readFile(`../docs/guides/${n}`, "utf8"),
  saveDir: "/private/tmp/claude-501/-Users-vansh-Coding-Side-projects--new-ideas--WishWorks/a95e2cf9-7474-4bdc-b92d-32685748bc35/scratchpad/meta-out",
  onStep: (x) => console.log(JSON.stringify(x)),
  title: chatTitle("meta", "HBD-Kitty01"),
}).catch(async (err) => {
  await page.screenshot({ path: "/private/tmp/claude-501/-Users-vansh-Coding-Side-projects--new-ideas--WishWorks/a95e2cf9-7474-4bdc-b92d-32685748bc35/scratchpad/fail.png" });
  console.log("FAIL", err.message, await page.locator("#prompt-textarea").count(), page.url());
  console.log(await page.evaluate(() => [...document.querySelectorAll("[role=dialog], [role=alert]")].map(d => d.textContent?.slice(0, 300))));
  await s.close(); process.exit(1);
});
console.log("url", page.url());
// Dump what the last turn looks like, to see the file link's real shape.
console.log(await page.locator("[data-message-author-role=assistant]").last().innerHTML().then((h) => h.slice(0, 3000)));
console.log(await page.evaluate(() => [...document.querySelectorAll("a")].filter(a => /json|sandbox/.test(a.textContent + a.href)).map(a => a.outerHTML.slice(0,300))));
await page.waitForTimeout(5000);
await s.close();
