# WishWorks app — setting it up on Windows

For the person receiving the app. You do not need to install Node, npm, or anything
technical. Two things only: **Google Chrome**, and the WishWorks installer.

---

## Before you install

**Google Chrome must be on this computer.** Not Edge — Chrome specifically. The app fills
the Flipkart form inside your own Chrome window, so it needs that exact browser.
Get it from https://www.google.com/chrome if it is not already there.

If you skip this, the app will tell you so in plain words when you reach the login step.

---

## Installing

1. Open the download link Vansh sends you and download `WishWorks Setup <version>.exe`.
2. Double-click it.
3. **Windows will show a blue box: "Windows protected your PC".** This is expected and it is
   not a virus. Click **More info**, then **Run anyway**.

   You will see this once, on the first install. It appears because the app is not signed
   with a paid Microsoft certificate — a cost that is not worth it for two users.
4. Choose where to install it, or accept the default. Finish.

**You only ever do this once.** After this the app updates itself: every time you open it,
it quietly checks for a new version, downloads it in the background, and installs it when
you close the app. Vansh never has to send you a file again.

---

## The first time you open it

1. Go to the **Flipkart login** step and sign in as you normally would, OTP and all.
2. That is it — the login is remembered from then on. You should not have to log in again
   on this computer.

**If it ever asks you to log in again, tell Vansh** rather than working around it. It means
something is wrong, and it is a known bug he wants to hear about.

---

## Every day after that

The steps in the app run in order, and each one says what it does. Nothing is locked — you
can open any step at any time, and if one goes wrong you re-run **that step**, not the
whole thing.

Roughly:

1. **Convert images** — drop the photos in, they come out in the right format and size.
2. **Build the images** — the app gives you prompts to copy into ChatGPT, one at a time,
   in order. Copy the one it shows you, paste it into ChatGPT, bring the result back.
3. **Finish / check** — the app names the files and checks them.
4. **Fill the listing** — opens Flipkart and types the values into the form.

**The app never presses Submit.** It fills the form and stops so a human can read it and
send it. That is deliberate — a wrong listing on a live marketplace is slow and public to
undo.

---

## What is not automated yet

So you are not surprised by it:

- **Meesho is still copy-paste.** The app shows you the values with a copy button per
  field; you paste them into the Meesho Supplier Panel yourself.
- **On Flipkart, only some tabs fill automatically.** *Additional Description* is done.
  The *Product Description* tab is not mapped yet, so check it by hand before submitting.
- **Writing the words** — titles, descriptions — happens in ChatGPT via the prompts the
  app hands you. The app itself never talks to any AI.

---

## If something goes wrong

Tell Vansh **which step** you were on and **what the screen said**, word for word. The app
is written to name the step and the cause rather than just fail, so that message is
usually the whole answer.

One thing worth trying first: **close every Chrome window the app opened, then run the step
again.** A leftover window can hold the login file and confuse the next run.
