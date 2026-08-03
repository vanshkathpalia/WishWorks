// connect.test.ts — the process-list parsing behind ensureProfileFree (WW-108).
//
// This is tested and the rest of connect.ts is not, because it is the one part with a silent
// failure mode: return an empty list on a machine that DOES have a stale Chrome and everything
// looks fine right up until the app comes up logged out (WW-061). Real fixtures, both formats,
// including the Windows one that can never run on this Mac.

import { describe, expect, it } from "vitest";
import { pidsHoldingProfile } from "../src/connect.js";

const MAC_PROFILE = "/Users/v/Library/Application Support/WishWorks/profile";
const WIN_PROFILE = "C:\\Users\\Partner\\AppData\\Roaming\\WishWorks\\profile";

describe("pidsHoldingProfile", () => {
  it("takes the pid from ps output, and only for our profile", () => {
    const lines = [
      `  4821 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=${MAC_PROFILE} --start-maximized`,
      "  4900 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "  5001 /usr/bin/some-other-thing",
    ];
    expect(pidsHoldingProfile(lines, MAC_PROFILE, "1")).toEqual(["4821"]);
  });

  it("reads the PowerShell output the same way — one parser, both platforms", () => {
    // Get-CimInstance is asked for "$ProcessId $CommandLine" precisely so Windows output is
    // ps-shaped. A Windows path is full of backslashes and spaces; none of that reaches the pid.
    const lines = [
      `7312 "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir=${WIN_PROFILE} --start-maximized`,
      '7400 "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --profile-directory=Default',
    ];
    expect(pidsHoldingProfile(lines, WIN_PROFILE, "1")).toEqual(["7312"]);
  });

  it("never returns our own pid — killing it would take the app down with it", () => {
    const lines = [`  999 chrome --user-data-dir=${MAC_PROFILE}`];
    expect(pidsHoldingProfile(lines, MAC_PROFILE, "999")).toEqual([]);
  });

  it("returns nothing rather than garbage when the listing has no match", () => {
    expect(pidsHoldingProfile(["", "  header junk"], MAC_PROFILE, "1")).toEqual([]);
  });
});
