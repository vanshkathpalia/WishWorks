// login.ts — log in to Flipkart Seller. The session is stored in ./profile and reused by
// every scan/fill run afterwards.
//
// Login state is detected by watching the URL: Flipkart bounces unauthenticated requests
// to /?referral_url=..., and lands a real session on /index.html#dashboard/... We poll the
// page you're on WITHOUT navigating, so nothing interrupts your OTP.
//
// Ctrl+C or closing the window are both safe — Chrome is shut down gracefully so the
// session is written to disk.
import { openBrowser, activePage, looksLoggedIn, checkLogin, APP_URL } from "./connect.js";

const { context, close } = await openBrowser();
const page = await activePage(context);

if (await checkLogin(page)) {
  console.log(`
✅ Already logged in — session is live.
   Next:  npm run scan balloon-decoration`);
  await close();
  process.exit(0);
}

console.log(`
================================================================
 Please log in to Flipkart Seller in the opened window.

 Click "Login" (top right), enter your credentials + OTP.
 Whatever page Flipkart lands you on afterwards is fine —
 Rising Star, Challenges, Listings, anything.

 I'm watching for the session and will confirm automatically.
================================================================
`);
await page.goto(APP_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

process.stdout.write("Waiting for you to log in");
const deadline = Date.now() + 10 * 60_000;
let ok = false;
while (Date.now() < deadline) {
  const current = await activePage(context); // you may log in in a different tab
  if (looksLoggedIn(current)) { ok = true; break; }
  await new Promise((r) => setTimeout(r, 2000));
  process.stdout.write(".");
}

console.log(
  ok
    ? `\n
✅ Logged in — session saved to ./profile.
   Next:  npm run scan balloon-decoration`
    : `\n
⚠️  Timed out without detecting a session.
   If the browser shows you logged in, just run the scan anyway —
   it warns but never blocks.`
);

await close(); // graceful → session written to disk
process.exit(0);
