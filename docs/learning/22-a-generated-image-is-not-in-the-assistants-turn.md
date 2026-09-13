# 22 — A generated image is not in the assistant's turn, and there is no download button

**Decision (WW-189):** `src/chat-core.ts` drives ChatGPT image generation: paste the prompt, wait
for the stop button to disappear, then take the image that **was not on the page before** and fetch
its bytes from inside the page.

**Every reasonable guess about this was wrong**, and each was measured on 2026-09-13 rather than
reasoned about:

| the obvious way | what actually happens |
|---|---|
| wait for an assistant turn containing an `img` | `[data-message-author-role]` listed **only the user turn** while a finished 1254×1254 image sat on the page. That wait never returns. |
| click the download button | there isn't one. The image is at `chatgpt.com/backend-api/estuary/content?id=file_…&sig=…`, same-origin, cookie-authenticated — so it is fetched from **inside the page**, the same trick the contents photo already uses. |
| take the last image on the page | a chat already holds what was uploaded to it and everything generated earlier. The **set difference** is the only reading that survives a second and third image in one chat — which is exactly what the hero → infographic → sizes flow is. |
| poll for the stop button immediately | it appears a beat AFTER Enter, so an immediate check sees none and calls the job finished before it started. Hence `settleMs`. |

**The chat is reused on purpose.** The hero, the infographic and the sizes sheet are one product and
each prompt refers to what came before — that is how Vansh does it by hand, and a fresh chat per
image throws away the context the next prompt depends on. It is also why "the newest image" had to
be defined properly: by the third round the page is holding four pictures that are not the answer.

**Measured:** 42 seconds for one image, 943 KB, 1254×1254 PNG. The wait is four minutes and a
timeout **returns what it has** rather than throwing — a run of four images must not be lost because
the third was slow, and the tab stays open for a human to look at.

**Still to build on this:** the four-prompt sequence itself (`PROMPT-read-pack` → `PROMPT-main-image`
→ `PROMPT-infographic` → `PROMPT-infographic-sizes`), and where the results land —
`wishworks-ready/<THEME>/` under the naming rule in `ready-core.ts`.
