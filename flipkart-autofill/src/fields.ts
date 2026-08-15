// fields.ts — the shared engine: discovers the fields on the open Flipkart listing form,
// fills one by its visible label, and reads the value back to prove it landed.
//
// ROW-ANCHORED, and that is the whole design. Flipkart renders every attribute as one
// self-contained row (verified against the live form, 2026-07-20):
//
//   div[class*=EditAttributeItemWrapper]        ← one row == exactly one attribute
//   ├── div[class*=AttributeItemLabelName]      ← the label, exact text, no junk
//   ├── div[class*=EditAttributeFieldWrapper]   ← the control
//   └── div[class*=AttributeItemQualifierWrapper]  ← unit picker (Year, kg) — optional
//
// The previous engine went the other way: for each control, climb up to 8 ancestors
// hunting for a sibling that looked like a label. Climb that far on this DOM and you
// read the NEXT field's label — which is how five different warranty labels all resolved
// to the single "Year" unit dropdown, and how "Purpose" ended up pointed at an input
// named guardstick_material. Anchoring on the row makes that class of error impossible:
// a label physically cannot escape its own row.
//
// Class names are matched with [class*=…] because styled-components suffixes churn
// between deploys; the semantic part of the name is what's stable.
import type { Page } from "playwright";

export interface FieldInfo {
  label: string;
  /** "pills" = rti tag input: type, press Enter, the value becomes a chip */
  kind: "text" | "textarea" | "select" | "combobox" | "pills";
  multi: boolean;   // "Multiple values allowed. Press Enter or ',' after each value"
  hint?: string;
  /** allowed values, when we could recover them (unit/Yes-No dropdowns) */
  options?: string[];
  /** a unit/option selector attached to its field — not an attribute of its own */
  companion?: boolean;
  /** page furniture (FSN, Rate Card) — on the page but not a category attribute */
  furniture?: boolean;
}

/**
 * Shared in-page helpers, injected as a source string.
 *
 * page.evaluate serialises each function on its own, so one cannot call another. Rather
 * than maintain three drifting copies of the row lookup (the drift is what produced the
 * bug this file exists to fix), the helpers are defined once here and prepended to each
 * evaluated function via `new Function`.
 */
const HELPERS = `
  const ROW_SEL   = '[class*="EditAttributeItemWrapper"]';
  const LABEL_SEL = '[class*="AttributeItemLabelName"]';
  const FIELD_SEL = '[class*="EditAttributeFieldWrapper"]';
  const QUAL_SEL  = '[class*="QualifierWrapper"]';
  const CTRL_SEL  = 'input:not([type=hidden]):not([type=file]), textarea, select, [role="combobox"]';

  const norm = (s) => (s ?? "").trim().toLowerCase().replace(/\\s+/g, " ").replace(/\\s*\\*+$/, "");

  // A pill input shrinks to a sliver once the row is full of chips, so a width threshold
  // reports a perfectly good field as "not visible". Rendered-ness is the real question.
  const visible = (el) => {
    if (!el) return false;
    if (el.offsetParent === null) return false;
    if (String(el.className).includes("rti--input")) return true;
    const r = el.getBoundingClientRect();
    return r.width > 20 && r.height > 8;
  };

  /** Every attribute row on the page, in document order. */
  const rows = () => Array.from(document.querySelectorAll(ROW_SEL));

  const rowLabel = (row) => (row.querySelector(LABEL_SEL)?.textContent ?? "").trim();

  /** The row's real control — never the unit picker beside it. */
  const primaryControl = (row) => {
    const field = row.querySelector(FIELD_SEL) ?? row;
    return Array.from(field.querySelectorAll(CTRL_SEL)).find((c) => !c.closest(QUAL_SEL)) ?? null;
  };

  /** The unit / qualifier picker (Year, kg), when the row has one. */
  const qualifierControl = (row) => {
    const q = row.querySelector(QUAL_SEL);
    return q ? q.querySelector(CTRL_SEL) : null;
  };

  const kindOf = (el) => {
    if (!el) return null;
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
    if (String(el.className).includes("rti--input")) return "pills";
    if (el.getAttribute("role") === "combobox" || tag === "button") return "combobox";
    if (el.hasAttribute("readonly")) return "combobox";
    return "text";
  };

  /**
   * Find the control for a label. "Weight (unit)" addresses the qualifier picker in the
   * Weight row; "Material #2" addresses the second row labelled Material.
   */
  const findControl = (label) => {
    const unit = /^(.*?)\\s*\\((?:unit|option)\\)$/.exec(String(label).trim());
    const dup  = /^(.*?)\\s*#(\\d+)$/.exec((unit ? unit[1] : String(label)).trim());
    const want = norm(dup ? dup[1] : (unit ? unit[1] : label));
    const nth  = dup ? Number(dup[2]) : 1;
    let hits = 0;
    for (const row of rows()) {
      if (norm(rowLabel(row)) !== want) continue;
      if (++hits !== nth) continue;
      const el = unit ? qualifierControl(row) : primaryControl(row);
      return el && visible(el) ? el : null;
    }
    return null;
  };

  /**
   * Values already committed as pills/chips in this row. Each chip carries a remove
   * button whose accessible text is "Close", so it lands inside textContent and has to
   * be stripped or every value reads back as "<value>Close" and fails verification.
   */
  const pillsIn = (el) => {
    const c = el.closest('[class*="rti--container"], .rti--container');
    if (!c) return [];
    return Array.from(c.children)
      .filter((n) => n !== el && n.tagName.toLowerCase() !== "input")
      .map((n) => (n.textContent ?? "").replace(/(?:Close|Remove|[\\u00d7✕✖])\\s*$/i, "").trim())
      .filter(Boolean);
  };

  /** A dropdown button's chosen text — without the chevron icon's "ExpandMore" title. */
  const buttonText = (el) => {
    const t = el.querySelector('[class*="ButtonText"]');
    return ((t ?? el).textContent ?? "").trim();
  };

  /** The popover belonging to a dropdown button (ids repeat, so scope by container). */
  const popoverFor = (btn) => {
    const box = btn.closest('[class*="SingleSelectContainer"]') ?? btn.parentElement;
    return box ? box.querySelector('[data-testid="content-single-select"], [role="dialog"]') : null;
  };
`;

/** Build a page function that has HELPERS in scope. */
const inPage = <A, R>(body: string): ((arg: A) => R) =>
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(
    "arg",
    // tsx/esbuild injects __name() calls that don't exist inside the page
    `globalThis.__name ??= (f) => f;\n${HELPERS}\nreturn (${body})(arg);`
  ) as (arg: A) => R;

/** Discover every attribute row on the page. */
const COLLECT = inPage<null, FieldInfo[]>(`() => {
  const out = [];
  const seen = new Set();
  for (const row of rows()) {
    const label0 = rowLabel(row);
    const el = primaryControl(row);
    if (!label0 || !el || !visible(el)) continue;

    // Never silently drop a duplicate — suffix it so it stays addressable.
    let label = label0;
    if (seen.has(label)) { let n = 2; while (seen.has(label + " #" + n)) n++; label = label + " #" + n; }
    seen.add(label);

    const multi = /multiple values/i.test(row.textContent ?? "") || kindOf(el) === "pills";
    const furniture = /^(FSN|Rate Card)\\b/i.test(label);
    out.push({
      label,
      kind: kindOf(el),
      multi,
      hint: multi ? "Multiple values allowed" : undefined,
      companion: false,
      furniture,
    });

    // The unit picker rides along as "<label> (unit)" — its own entry, never an attribute.
    const q = qualifierControl(row);
    if (q && visible(q)) {
      const ql = label + " (unit)";
      seen.add(ql);
      out.push({
        label: ql,
        kind: kindOf(q),
        multi: false,
        options: (q.textContent ?? "").split(/\\s{2,}|\\n/).map((s) => s.trim()).filter(Boolean).slice(0, 20),
        companion: true,
        furniture: false,
      });
    }
  }
  return out;
}`);

/** Mark one field's control so Playwright can drive it; returns its kind. */
const TAG = inPage<string, string | null>(`(label) => {
  document.querySelectorAll("[data-wf-target]").forEach((e) => e.removeAttribute("data-wf-target"));
  const el = findControl(label);
  if (!el) return null;
  el.setAttribute("data-wf-target", "1");
  el.scrollIntoView({ block: "center" });
  return kindOf(el);
}`);

/** Read back what the tagged control actually holds now. */
const READBACK = inPage<null, string | null>(`() => {
  const el = document.querySelector("[data-wf-target]");
  if (!el) return null;
  const kind = kindOf(el);
  if (kind === "select") return el.selectedOptions[0]?.textContent?.trim() ?? "";
  // A pill input clears itself after each Enter, so .value is ALWAYS "" once the value
  // has been accepted — the committed values live in sibling chips. Reading .value here
  // is what made 12 correct fills look like failures.
  if (kind === "pills") return pillsIn(el).join(" | ");
  if (kind === "combobox") return buttonText(el);
  return (el.value ?? "").trim();
}`);

/**
 * Inside an open dropdown: mark its search box, or mark the option matching `value`.
 *
 * Typing + Enter does NOT select in this widget — the button just kept reading "Select".
 * The option has to be clicked, so we tag it here and let Playwright click it with a
 * real mouse event.
 */
const TAG_IN_POPOVER = inPage<{ value: string; what: "search" | "option" }, string>(`({ value, what }) => {
  const btn = document.querySelector("[data-wf-target]");
  if (!btn) return "no-target";
  const pop = popoverFor(btn);
  if (!pop) return "no-popover";

  if (what === "search") {
    document.querySelectorAll("[data-wf-search]").forEach((e) => e.removeAttribute("data-wf-search"));
    const box = pop.querySelector('input:not([type=hidden])');
    if (!box) return "no-search";
    box.setAttribute("data-wf-search", "1");
    return "ok";
  }

  document.querySelectorAll("[data-wf-option]").forEach((e) => e.removeAttribute("data-wf-option"));
  const want = norm(value);
  const leaves = Array.from(pop.querySelectorAll("*")).filter(
    (n) => n.children.length === 0 && norm(n.textContent ?? "") === want
  );
  if (!leaves.length) {
    // Report what WAS on offer — a value that isn't in Flipkart's list is a data problem,
    // and the fix is to correct the JSON, so the options belong in the error.
    const offered = Array.from(pop.querySelectorAll("*"))
      .filter((n) => n.children.length === 0)
      .map((n) => (n.textContent ?? "").trim())
      .filter((t) => t && t.length < 40);
    return "no-option:" + Array.from(new Set(offered)).slice(0, 25).join(" | ");
  }
  // climb to the row that actually handles the click (label / option / checkbox row)
  let node = leaves[0];
  for (let i = 0; i < 4 && node.parentElement; i++) {
    if (node.getAttribute("role") || ["LABEL", "BUTTON", "LI"].includes(node.tagName)) break;
    node = node.parentElement;
  }
  node.setAttribute("data-wf-option", "1");
  return "ok";
}`);

export async function extractFields(page: Page): Promise<FieldInfo[]> {
  return (await page.evaluate(COLLECT, null)) as FieldInfo[];
}

export type FillStatus = "filled" | "not_found" | "failed" | "mismatch";

export interface FillResult {
  status: FillStatus;
  /** what the field actually contained after we filled it (read back from the DOM) */
  actual?: string;
}

/**
 * Fill one field by its visible label, then READ IT BACK and verify.
 *
 * The verification step is the whole point: a blind bot reports success because it
 * pressed keys, not because the value landed. We re-read the field and return
 * "mismatch" (with the actual content) if what's there isn't what we asked for —
 * so a wrong value is always reported, never silently submitted.
 */
export async function fillField(
  page: Page,
  label: string,
  value: string | number | string[]
): Promise<FillResult> {
  const kind = await page.evaluate(TAG, label);
  if (!kind) return { status: "not_found" };
  const el = page.locator("[data-wf-target]");
  const values = Array.isArray(value) ? value.map(String) : [String(value)];

  try {
    if (kind === "select") {
      await el.selectOption({ label: values[0] });
    } else if (kind === "pills") {
      // Type, Enter, repeat: each Enter commits the text as a chip and empties the box.
      await el.click();
      for (const v of values) {
        await page.keyboard.type(v, { delay: 15 });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(120);
      }
    } else if (kind === "combobox") {
      // Open, filter, then CLICK the option. Typing + Enter left the button reading
      // "Select" — this widget only commits on a real click. We match the option by its
      // text, never by arrow-key count, so a reordered list can't select the wrong one.
      await el.click();
      await page.waitForTimeout(300);

      if ((await page.evaluate(TAG_IN_POPOVER, { value: values[0], what: "search" as const })) === "ok") {
        await page.locator("[data-wf-search]").fill(values[0]);
        await page.waitForTimeout(350);
      }

      const marked = await page.evaluate(TAG_IN_POPOVER, { value: values[0], what: "option" as const });
      if (marked !== "ok") {
        await page.keyboard.press("Escape");
        return {
          status: "mismatch",
          actual: marked.startsWith("no-option:")
            ? `option "${values[0]}" not offered. Available: ${marked.slice("no-option:".length)}`
            : `could not open the dropdown (${marked})`,
        };
      }
      await page.locator("[data-wf-option]").click();
      await page.waitForTimeout(200);
      await page.keyboard.press("Escape"); // multi-selects stay open after a pick
      await page.waitForTimeout(150);
    } else {
      await el.click();
      // Join, never values[0]. A list aimed at a plain text box used to type its first entry
      // and drop the rest — and the read-back said ✅, because what landed was genuinely what
      // we typed. "Items Included" is nine items on one line if the widget is a text box and
      // nine chips if it is a pill input; we cannot know which until we are on the tab, so the
      // value stays a list and this branch is what makes a list survive the plain-box case.
      await el.fill(values.join(", "));
    }
    await page.waitForTimeout(150); // let React settle before reading back
  } catch {
    return { status: "failed" };
  }

  const actual = (await page.evaluate(READBACK, null)) ?? "";
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const ok = values.every((v) => norm(actual).includes(norm(v)));
  return { status: ok ? "filled" : "mismatch", actual };
}

export interface FieldProbe {
  tag: string;
  type: string | null;
  role: string | null;
  kind: string | null;
  readOnly: boolean;
  disabled: boolean;
  value: string;
  pills: string[];
  rowLabel: string;
  rowText: string;
  rowHtml: string;
}

const PROBE = inPage<string, FieldProbe | null>(`(label) => {
  const el = findControl(label);
  if (!el) return null;
  const row = el.closest(ROW_SEL) ?? el;
  return {
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute("type"),
    role: el.getAttribute("role"),
    kind: kindOf(el),
    readOnly: !!el.readOnly,
    disabled: !!el.disabled,
    value: el.value ?? "",
    pills: kindOf(el) === "pills" ? pillsIn(el) : [],
    rowLabel: rowLabel(row),
    rowText: (row.innerText ?? "").replace(/\\n+/g, " ⏎ ").slice(0, 300),
    rowHtml: row.outerHTML.slice(0, 1200),
  };
}`);

/**
 * Describe the widget behind `label` without touching it — used to explain a mismatch.
 * Reports the row's OWN label too, so a mis-targeted field is obvious at a glance.
 */
export async function probeField(page: Page, label: string): Promise<FieldProbe | null> {
  return (await page.evaluate(PROBE, label)) as FieldProbe | null;
}

export interface StructureProbe {
  labelEl: string;
  levelsUp: number;
  chain: string[];
  rowClass: string;
  controls: Array<{
    tag: string;
    type: string | null;
    role: string | null;
    name: string | null;
    cls: string;
    value: string;
    text: string;
    qualifier: boolean;
  }>;
  rowText: string;
  rowHtml: string;
}

const STRUCTURE = inPage<string, StructureProbe[]>(`(label) => {
  const want = norm(label);
  const leaves = Array.from(document.querySelectorAll("*")).filter(
    (el) => el.children.length === 0 && norm(el.textContent ?? "") === want
  );
  return leaves.slice(0, 3).map((leaf) => {
    const chain = [];
    let row = leaf;
    for (let i = 0; i < 12 && row.parentElement; i++) {
      if (row.querySelectorAll(CTRL_SEL).length > 0) break;
      row = row.parentElement;
      chain.push(row.tagName.toLowerCase() + "." + (String(row.className).split(/\\s+/)[0] || "(no class)"));
    }
    const controls = Array.from(row.querySelectorAll(CTRL_SEL)).map((c) => ({
      tag: c.tagName.toLowerCase(),
      type: c.getAttribute("type"),
      role: c.getAttribute("role"),
      name: c.getAttribute("name"),
      cls: String(c.className).slice(0, 90),
      value: c.value ?? "",
      text: (c.innerText ?? "").trim().slice(0, 40),
      qualifier: !!c.closest(QUAL_SEL),
    }));
    return {
      labelEl: leaf.tagName.toLowerCase() + "." + (String(leaf.className).split(/\\s+/)[0] || "(no class)"),
      levelsUp: chain.length,
      chain,
      rowClass: String(row.className),
      controls,
      rowText: (row.innerText ?? "").replace(/\\n+/g, " ⏎ ").slice(0, 300),
      rowHtml: row.outerHTML.slice(0, 2500),
    };
  });
}`);

/** Label-first view of a field's row — the tool that found the row structure. Read-only. */
export async function probeStructure(page: Page, label: string): Promise<StructureProbe[]> {
  return (await page.evaluate(STRUCTURE, label)) as StructureProbe[];
}

/** Every enabled button on the page that looks like a save action, in DOM order. */
const TAG_SAVE = inPage<string | null, string[]>(`(prefer) => {
  document.querySelectorAll("[data-wf-save]").forEach((e) => e.removeAttribute("data-wf-save"));
  const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type=submit]'))
    .filter((b) => visible(b) && !b.disabled && !b.getAttribute("aria-disabled"))
    .map((b) => ({ b, t: (b.innerText ?? b.value ?? "").trim() }))
    .filter(({ t }) => /save|submit|send for qc/i.test(t) && t.length < 40);
  if (!buttons.length) return [];
  const pick = prefer
    ? buttons.find(({ t }) => norm(t) === norm(prefer)) ?? null
    : buttons.find(({ t }) => /save/i.test(t)) ?? buttons[0];
  if (pick) pick.b.setAttribute("data-wf-save", "1");
  return buttons.map(({ t }) => t);
}`);

/**
 * Click the form's Save button.
 *
 * Deliberately opt-in (`--save`): this tool's contract is that a human sees the values
 * before they are committed. But NOT offering it at all is worse — a filled form that
 * dies with the browser is 30 fields of work thrown away.
 *
 * Returns every save-ish button it found, so a wrong guess is visible rather than silent.
 */
export async function clickSave(
  page: Page,
  prefer?: string
): Promise<{ clicked: string | null; candidates: string[] }> {
  const candidates = (await page.evaluate(TAG_SAVE, prefer ?? null)) as string[];
  const target = page.locator("[data-wf-save]");
  if (!candidates.length || (await target.count()) === 0) return { clicked: null, candidates };
  const clicked = (await target.innerText()).trim();
  await target.click();
  await page.waitForTimeout(2500); // let the SPA post and re-render
  return { clicked, candidates };
}
