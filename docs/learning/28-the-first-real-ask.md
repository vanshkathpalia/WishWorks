# 28 — The first real ask, and the two bugs only a real one could find

**2026-09-14.** Vansh: *"have you tested running a real ChatGPT chat for this too? do it."* Worth
doing, because the engine was fully tested and did not work.

## Bug one: an 11 KB paste does not land in 1.5 seconds

`sendPrompt` pasted, waited a fixed 1,500 ms, then pressed Enter. Fine for the 5 KB costing prompt.
The supplier-words prompt carries the whole price list — **11 KB** — and the paste had not landed,
so Enter fired on an EMPTY composer. No message sent, **no chat even created**, and the run reported
*"reply: 0 chars"* as though the model had answered with nothing.

Now it polls the composer until the text is actually there. **Waiting on a condition rather than a
duration** is the general form, and this file has been bitten by the duration version before.

## Bug two: `prompt` is a DOM global, so the wrong name typechecked

The fix above first read `prompt.trim().length` where the parameter is called `text`. `tsc --noEmit`
passed — `prompt` is `window.prompt`, and the GUI tsconfig has `lib: DOM`. It failed at runtime,
after the browser had opened. *A name that typechecks is not a name that exists.*

## What the model actually did

```
prompt 11,065 chars -> reply 6,287 chars
words: 1   aliases: 40   new: 17   split: 1   unsure: 15
```

It found `kt` -> `fringe` unaided, proposed 40 aliases, and used `unsure` properly — *"no golden
HBD row exists"*, *"there is no navy blue banner row"*. That is the behaviour the prompt asks for and
it is the behaviour that makes this safe to use.

**And it invented a material.** Among the nets it listed White, Yellow and Green — all real — and
slipped in **Pink Net**, which does not exist. `reviewProposal` refused it, on the first real run,
which is exactly what the check was written for. The model is told not to invent rows; being told
is not the same as not doing it.

One of the forty named its row `Decoration | Car Theme Set of 5` — the shape the list is SHOWN in.
A real row that read as an invention, so only the part after the last `|` is taken now.

**The shape of the result is the argument for the design:** 38 usable rules, 1 formatting quirk,
1 hallucination caught, 15 honest refusals. None of it applied without a human ticking it.
