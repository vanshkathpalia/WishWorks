# 21 — The costing chat is pasted, not typed, and lives in its own browser

**Decision (WW-188):** `askChatGpt` opens a SECOND Chrome, clears the composer, and **pastes** the
prompt. Three separate faults, each of which looked fine until it was counted.

## 1. Google will not sign in to an automated browser

Signing in to ChatGPT with a Google account fails at *"Couldn't sign you in — this browser or app
may not be secure."* Email-and-password does not avoid it: OpenAI hands a Google-backed account
straight back to Google.

**It is not the profile, and that is worth knowing because the obvious fix is the wrong one.**
Measured on a brand-new empty profile:

```
no flag   -> navigator.webdriver = true    <- refused
with flag -> navigator.webdriver = false   <- signed in
```

Google objects to the browser being DRIVEN, not to what is on it. Clearing profiles, making a fresh
one, signing out of Flipkart — none of it would have helped.

So the switch is `--disable-blink-features=AutomationControlled`, and it lives on a browser that
opens `chatgpt.com` and nothing else, with its own profile. Vansh, on the version that put it on
every launch: *"I don't think my partner will be able to open this app comfortably now."* He was
right. The Flipkart browser — the one the business partner's machine runs all day — is untouched and
perfectly ordinary. **The separate window does not make the sign-in work; the flag does.** What the
window buys is containment, and two accounts not sharing a cookie jar.

`profile-chat/` had to be added to `.gitignore` by hand: `profile/` is a directory name and did not
match it. A session cookie in git is a logged-in account in git.

## 2. ChatGPT keeps an unsent draft

The composer is not empty when a new chat opens — it still holds the last unsent prompt. Typing
into it APPENDS. A 4,890-character prompt came back as **9,648**: the whole thing twice, tail
intact, which is exactly why it reads as correct until you count. Two conflicting copies of the
rules is worse than none, because the model follows whichever it likes. Select-all and Delete first.

## 3. Typing sends Enter

`pressSequentially` sends real keystrokes, so every `\n` is an Enter **into a composer where Enter
sends the message**. It did not fire here; the cost of being wrong about that is a half-typed prompt
sent to the model. It also ate the paragraph breaks — `…in this kit.\n\nReply with NOTHING but…`
arrived as `…in this kit.Reply with…`, the rules run into the sentence before them.

A clipboard paste is one event, keeps the text exactly as written, and never touches Enter. After
it, prompt and composer differ at character 4,890 of 4,890 — that is, not at all.

**The lesson under all three:** every one of these passed a look. The tail was right, the state said
`ready`, the chat had an image and a prompt in it. They were only found by *counting the characters
and diffing the text* — which is the same lesson as WW-081, where a truncated ANSWER read as a
complete one.
