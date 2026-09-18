/**
 * vitest.config.ts — one setting, and it is about honesty rather than taste.
 *
 * **The 5-second default is too short for the tests that resize real images.** `sharp` writes four
 * 1500×1500 JPEGs in `tests/images.test.ts`, which takes well under a second on an idle Mac and over
 * five on a loaded one — it flaked here twice on 2026-09-17 and then failed v1.7.8's build on the
 * Windows runner, where sharp is slower and the machine is shared. A build that fails on timing says
 * nothing about the code, and a flaky suite is one nobody reads.
 *
 * 30 seconds, applied to every test: a real failure still fails, and a slow machine no longer decides
 * whether the build is green.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
