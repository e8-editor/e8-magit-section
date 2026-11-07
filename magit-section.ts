// SPDX-License-Identifier: GPL-3.0-or-later
//
// Sections, after magit-section.el 4.4.0, from Magit
// (https://github.com/magit/magit): a buffer of nested sections, each a
// heading and its content, which TAB hides and shows. Sections have a
// type and a value, which together with their ancestors' identify them
// across refreshes, so a section made again keeps its visibility; their
// initial visibility comes from magit-section-set-visibility-hook, the
// section's earlier incarnation, magit-section-initial-visibility-alist,
// or the inserter. A section's body can be inserted only when it is first
// shown, an empty section can be cancelled, and a heading ending in ":"
// gets the number of children. n and p move to the next and previous
// section, M-n and M-p to siblings, ^ to the parent; 1 to 4 show the
// sections around point to that level and M-1 to M-4 all of them; C-<tab>
// cycles a section and <backtab> the buffer. The current section, or the
// sibling sections the region selects, are highlighted, and a section
// type can paint its own text when highlighted, as Magit's diffs do.
// Magit's buffers are made of them.
//
// Copyright (C) 2008-2025 The Magit Project Contributors
// Copyright (C) 2026 The E8 contributors
// Ported to E8 in 2026.
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the
// Free Software Foundation, either version 3 of the License, or (at your
// option) any later version.

import { forwardLine, PerBuffer, truthy } from "subr";

e8.defineFace({
  name: "magit-section-heading",
  doc: "Face for section headings.",
  attributes: { extend: true, weight: "bold" },
  light: { foreground: "DarkGoldenrod4" },
  dark: { foreground: "LightGoldenrod2" },
});
e8.defineFace({
  name: "magit-section-highlight",
  doc: "Face for highlighting the current section.",
  attributes: { extend: true },
  light: { background: "grey95" },
  dark: { background: "grey20" },
});
e8.defineFace({ name: "magit-section-secondary-heading", doc: "Face for section headings of some secondary headings.", attributes: { extend: true, weight: "bold" } });
e8.defineFace({ name: "magit-section-heading-selection", doc: "Face for selected section headings.", attributes: { extend: true }, light: { foreground: "salmon4" }, dark: { foreground: "LightSalmon3" } });
e8.defineFace({ name: "magit-section-child-count", doc: "Face used for child counts at the end of some section headings.", attributes: {} });
e8.defineFace({ name: "magit-left-margin", doc: "Face used for the left margin.", attributes: { inherit: "default" } });

e8.defineVariable({ name: "magit-section-highlight-current", doc: "Whether to highlight the current section.", value: true });
e8.defineVariable({ name: "magit-section-highlight-selection", doc: "Whether to highlight the selected sections.", value: true });
e8.defineVariable({ name: "magit-section-show-child-count", doc: "Whether to append the number of children to section headings.", value: true });
e8.defineVariable({
  name: "magit-section-cache-visibility",
  doc: "Whether to cache the visibility of sections that disappear and come back: t for all, or a list of section types.",
  value: true,
});
e8.defineVariable({
  name: "magit-section-initial-visibility-alist",
  doc: 'The initial visibility of sections: [type, "show" or "hide"] pairs, the type a section type or a list of types from the section up its lineage, or the visibility a function of the section.',
  value: [["stashes", "hide"]],
});
e8.defineVariable({
  name: "magit-section-visibility-indicator",
  doc: "How to show that a section can be expanded or collapsed: [hidden, shown] fringe bitmaps, [ellipsis, true] in a terminal, or nil for nothing.",
  value: ["magit-fringe-bitmap>", "magit-fringe-bitmapv"],
});
e8.defineVariable({ name: "magit-section-preserve-visibility", doc: "Whether sections keep their visibility when the buffer is made again.", value: true });
e8.defineVariable({ name: "magit-section-insert-in-reverse", doc: "Whether sections are inserted in reverse order, as some of Magit's washers insert them.", value: false });
e8.defineHook("magit-section-movement-hook", "Functions called after moving to a section, with the section.");
e8.defineHook("magit-section-set-visibility-hook", "Functions given a section being inserted that may say whether it starts hidden: show or hide.");
e8.defineHook("magit-insert-section-hook", "Hook run after a section's body is inserted, before it is finished.");

e8.defineFringeBitmap("magit-fringe-bitmap+", [0b00011000, 0b00011000, 0b00011000, 0b11111111, 0b11111111, 0b00011000, 0b00011000, 0b00011000]);
e8.defineFringeBitmap("magit-fringe-bitmap-", [0b00000000, 0b00000000, 0b00000000, 0b11111111, 0b11111111, 0b00000000, 0b00000000, 0b00000000]);
e8.defineFringeBitmap("magit-fringe-bitmap>", [0b01100000, 0b00110000, 0b00011000, 0b00001100, 0b00011000, 0b00110000, 0b01100000, 0b00000000]);
e8.defineFringeBitmap("magit-fringe-bitmapv", [0b00000000, 0b10000010, 0b11000110, 0b01101100, 0b00111000, 0b00010000, 0b00000000, 0b00000000]);
e8.defineFringeBitmap("magit-fringe-bitmap-bold>", [0b11100000, 0b01110000, 0b00111000, 0b00011100, 0b00111000, 0b01110000, 0b11100000, 0b00000000]);
e8.defineFringeBitmap("magit-fringe-bitmap-boldv", [0b10000001, 0b11000011, 0b11100111, 0b01111110, 0b00111100, 0b00011000, 0b00000000, 0b00000000]);

/** A section of a buffer, as magit-section's objects: its type and value, where it is, whether its content is hidden, and its children. */
export interface Section {
  type: string;
  value: unknown;
  start: number;
  /** Where the content starts, after the heading line; the end, for a section with no heading. */
  content: number;
  end: number;
  hidden: boolean;
  children: Section[];
  parent?: Section;
  /** Whether the section has a heading line, set by insertHeading. */
  heading?: boolean;
  /** Inserts the body the first time the section is shown, as magit-insert-section-body defers it. */
  washer?: () => void;
  /** The overlay that hides the content. */
  overlay?: number;
  /** The visibility indicator's overlay. */
  indicator?: number;
  /** How the section's text is painted: plainly, or highlighted, for a type that paints itself. */
  painted?: "plain" | "highlight";
  /** The inserter that made it, as magit-describe-section reports it. */
  inserter?: string;
}

/** What a section type does differently, as Magit's section classes do. */
export interface SectionType {
  /** The face its heading takes when highlighted, as heading-highlight-face. */
  headingHighlightFace?: string;
  /** The face its heading takes when selected, as heading-selection-face. */
  headingSelectionFace?: string;
  /** Whether only parts of it are highlighted, as selective-highlight. */
  selectiveHighlight?: boolean;
  /** Paints its text highlighted or not, as magit-section-paint; sections of a type with this are painted. */
  paint?: (section: Section, highlight: boolean) => void;
  /** Its value as it identifies the section, as magit-section-ident-value. */
  identValue?: (section: Section) => unknown;
  /** The keymap its text uses, as a section class's keymap slot. */
  keymap?: string;
}
const types = new Map<string, SectionType>();

/** Says what sections of TYPE do differently, as defining a magit-section subclass does. */
export function magitSectionDefineType(type: string, definition: SectionType): void {
  types.set(type, { ...(types.get(type) ?? {}), ...definition });
}

/** Each buffer's root section, and the sections in order. */
interface Tree {
  root: Section;
  all: Section[];
}
const roots = new PerBuffer<Tree>();
/** Each buffer's cached visibility, by identity, as magit-section-visibility-cache. */
const visibilityCache = new PerBuffer<Map<string, "show" | "hide">>();

/** What is being inserted: the current section innermost last, the old root, and every section made so far. */
interface Insertion {
  stack: Section[];
  oldRoot?: Section;
  made: Section[];
}
let insertion: Insertion | undefined;

class CancelSection {
  readonly section: Section;
  constructor(section: Section) {
    this.section = section;
  }
}

// Identity.

/** A section's value as it identifies it, as magit-section-ident-value: a string or number as it is, else what its type says. */
export function magitSectionIdentValue(s: Section): unknown {
  const fn = types.get(s.type)?.identValue;
  if (fn) return fn(s);
  const v = s.value;
  if (v === undefined || v === null || typeof v !== "object") return v;
  const o = v as { file?: string; hunk?: { heading?: string }; ident?: unknown };
  if (o.ident !== undefined) return o.ident;
  if (o.file !== undefined) return o.hunk?.heading !== undefined ? `${o.file}\0${o.hunk.heading}` : o.file;
  return JSON.stringify(v);
}

/** A section's identity: [type, value] pairs from it to the root, as magit-section-ident. */
export function magitSectionIdent(s: Section): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (let x: Section | undefined = s; x; x = x.parent) out.push([x.type, magitSectionIdentValue(x)]);
  return out;
}

const identKey = (s: Section): string => JSON.stringify(magitSectionIdent(s));

/** Whether A and B are the same section, as magit-section-equal. */
export const magitSectionEqual = (a?: Section, b?: Section): boolean => a !== undefined && b !== undefined && identKey(a) === identKey(b);

/** The section IDENT identifies, under ROOT or the buffer's root, as magit-get-section. */
export function magitGetSection(ident: [string, unknown][], root = sections()?.root): Section | undefined {
  const path = [...ident].reverse();
  let s = root;
  if (!s || path.length === 0 || path[0][0] !== s.type) return undefined;
  for (const [type, value] of path.slice(1)) {
    const key = JSON.stringify(value);
    s = s.children.find((c) => c.type === type && JSON.stringify(magitSectionIdentValue(c)) === key);
    if (!s) return undefined;
  }
  return s;
}

/** The types of a section and its ancestors, or the sections themselves with RAW, as magit-section-lineage. */
export function magitSectionLineage(s: Section, raw?: false): string[];
export function magitSectionLineage(s: Section, raw: true): Section[];
export function magitSectionLineage(s: Section, raw = false): (string | Section)[] {
  const out: (string | Section)[] = [];
  for (let x: Section | undefined = s; x; x = x.parent) out.push(raw ? x : x.type);
  return out;
}

/** A condition magitSectionMatch takes: a type, a lineage of types, or a list of conditions any of which. */
export type SectionCondition = string | { lineage: string[] } | SectionCondition[];

/**
 * Whether SECTION matches CONDITION, as magit-section-match: a type; a
 * lineage of types from the section upward, as Magit's [TYPE PARENT...],
 * "*" first to match their descendants too; or an array of conditions,
 * any of which.
 */
export function magitSectionMatch(condition: SectionCondition, section = currentSection()): boolean {
  if (!section) return false;
  if (typeof condition === "string") return section.type === condition;
  if (Array.isArray(condition)) return condition.some((c) => magitSectionMatch(c, section));
  const cond = condition.lineage;
  if (cond[0] === "*") {
    for (let s: Section | undefined = section; s; s = s.parent) if (lineageMatches(magitSectionLineage(s), cond.slice(1))) return true;
    return false;
  }
  return lineageMatches(magitSectionLineage(section), cond);
}
const lineageMatches = (lineage: string[], cond: string[]): boolean => cond.every((t, i) => lineage[i] === t);

/** The value of the section at point if it matches CONDITION, as magit-section-value-if. */
export function magitSectionValueIf(condition: SectionCondition, section = currentSection()): unknown {
  return section && magitSectionMatch(condition, section) ? section.value : undefined;
}

/** The value of the section's parent, as magit-section-parent-value. */
export const magitSectionParentValue = (s: Section): unknown => s.parent?.value;

/** The section's siblings, those before it with "prev", after with "next", as magit-section-siblings. */
export function magitSectionSiblings(s: Section, direction?: "prev" | "next"): Section[] {
  const siblings = s.parent?.children ?? [];
  const i = siblings.indexOf(s);
  if (direction === "prev") return siblings.slice(0, i).reverse();
  if (direction === "next") return siblings.slice(i + 1);
  return siblings.filter((x) => x !== s);
}

/** Calls FN on every section under SECTION, children first, ending with SECTION, as magit-map-sections. */
export function magitMapSections(fn: (s: Section) => void, section = sections()?.root): void {
  if (!section) return;
  for (const c of section.children) magitMapSections(fn, c);
  fn(section);
}

// Inserting.

/** Moves the positions of the sections that are at or after FROM by DELTA, as markers would move. */
function shift(from: number, delta: number, all: Section[]): void {
  for (const s of all) {
    if (s.start >= from) s.start += delta;
    if (s.content >= from) s.content += delta;
    if (s.end >= from) s.end += delta;
  }
}

/** Starts the buffer's sections afresh, as erase-buffer and magit-insert-section of the root do; BODY inserts them. */
export function insertRoot(type: string, body: () => void, value?: unknown): Section {
  const buffer = e8.currentBuffer();
  const old = roots.get(buffer);
  deleteHighlight();
  for (const ov of e8.overlaysIn(e8.pointMin(), e8.pointMax())) {
    if (e8.overlayGet(ov, "magit-section") !== undefined) e8.deleteOverlay(ov);
  }
  e8.deleteRegion(e8.pointMin(), e8.pointMax());
  const root: Section = { type, value, start: e8.point(), content: e8.point(), end: 0, hidden: false, children: [] };
  const outer = insertion;
  insertion = { stack: [root], oldRoot: old?.root, made: [] };
  try {
    body();
  } finally {
    insertion = outer;
  }
  root.end = e8.pointMax();
  root.content = root.start;
  const all: Section[] = [];
  const walk = (s: Section) => {
    for (const c of s.children) {
      all.push(c);
      walk(c);
    }
  };
  walk(root);
  roots.set(buffer, { root, all });
  for (const s of all) {
    setSectionProperties(s);
    applyVisibility(s);
  }
  highlightForce = true;
  return root;
}

/** Whether a section starts hidden: the hook, its earlier incarnation, the cache, the alist, or HIDE, as magit-insert-section--create. */
function initialHidden(s: Section, hide: boolean): boolean {
  const set = e8.runHookWithArgsUntilSuccess("magit-section-set-visibility-hook", s as unknown as e8.Value);
  if (set === "hide" || set === "show") return set === "hide";
  if (truthy(e8.variable("magit-section-preserve-visibility"))) {
    const old = insertion?.oldRoot && magitGetSection(magitSectionIdent(s), insertion.oldRoot);
    if (old) return old.hidden;
    const cached = visibilityCache.get(e8.currentBuffer())?.get(identKey(s));
    if (cached) return cached === "hide";
  }
  const alist = e8.variable("magit-section-initial-visibility-alist");
  if (Array.isArray(alist)) {
    for (const entry of alist as unknown[][]) {
      const key = entry[0];
      const matches = typeof key === "string" ? s.type === key : Array.isArray(key) ? magitSectionMatch({ lineage: key as string[] }, s) : false;
      if (matches) {
        const v = typeof entry[1] === "function" ? (entry[1] as (x: Section) => string)(s) : entry[1];
        return v === "hide";
      }
    }
  }
  return hide;
}

/**
 * Inserts a section of TYPE and VALUE, its heading and content inserted by
 * BODY, hidden at first if HIDDEN unless something says otherwise, as
 * magit-insert-section. BODY can cancel it with magitCancelSection; the
 * section given then is in no tree. INSERTER names the function inserting
 * it, for magit-describe-section.
 */
export function insertSection(type: string, value: unknown, hidden: boolean, body: () => void, inserter?: string): Section {
  if (!insertion) return insertRoot(type, body, value);
  const parent = insertion.stack[insertion.stack.length - 1];
  const s: Section = { type, value, start: e8.point(), content: e8.point(), end: e8.point(), hidden: false, children: [], parent, inserter };
  s.hidden = initialHidden(s, hidden);
  insertion.stack.push(s);
  insertion.made.push(s);
  try {
    body();
    e8.runHooks("magit-insert-section-hook");
  } catch (e) {
    if (e instanceof CancelSection && e.section === s) {
      insertion.made.splice(insertion.made.indexOf(s));
      return s;
    }
    throw e;
  } finally {
    insertion.stack.pop();
  }
  s.end = e8.point();
  if (!s.heading) s.content = s.end;
  insertChildCount(s);
  if (truthy(e8.variable("magit-section-insert-in-reverse"))) parent.children.unshift(s);
  else parent.children.push(s);
  return s;
}

/** Cancels the section being inserted, deleting its text, as magit-cancel-section; with IF-EMPTY only if its body is empty. */
export function magitCancelSection(ifEmpty = false): void {
  const s = insertion?.stack[insertion.stack.length - 1];
  if (!s || !s.parent) return;
  if (ifEmpty && e8.point() !== (s.heading ? s.content : s.start)) return;
  e8.deleteRegion(s.start, e8.point());
  throw new CancelSection(s);
}

/**
 * Inserts the section's heading line, as magit-insert-heading: in
 * magit-section-heading unless a part has faces of its own, with " (N)"
 * after it when the first part is a number, and the newline it needs.
 * Without parts, the line so far is the heading.
 */
export function insertHeading(...parts: (string | number | boolean | e8.PropertizedString)[]): void {
  const s = insertion?.stack[insertion.stack.length - 1];
  const count = typeof parts[0] === "number" || typeof parts[0] === "boolean" ? (parts.shift() as number | boolean) : undefined;
  if (parts.length > 0) {
    const strs = parts as (string | e8.PropertizedString)[];
    const faced = strs.some((p) => typeof p !== "string" && p.properties.some(([, , props]) => props.face !== undefined || props["font-lock-face"] !== undefined));
    const text = faced ? e8.concat(...strs) : e8.propertize(strs.map(String).join(""), { "font-lock-face": "magit-section-heading" });
    e8.insert(text);
    // A count of true is " (t)", the t replaced by the number of children once they are inserted.
    if (count !== undefined && count !== false && truthy(e8.variable("magit-section-show-child-count"))) e8.insert(e8.propertize(` (${count === true ? "t" : count})`, { "font-lock-face": "magit-section-child-count" }));
  }
  if (e8.point() > e8.pointMin() && e8.charBefore(e8.point()) !== "\n") e8.insert("\n");
  if (s) {
    s.content = e8.point();
    s.heading = true;
  }
}

/** Replaces a heading's final ":" with the number of children, as magit-insert-child-count. */
function insertChildCount(s: Section): void {
  if (!truthy(e8.variable("magit-section-show-child-count")) || !s.heading || s.children.length === 0) return;
  const colon = s.content - 2;
  if (colon >= s.start && e8.charAfter(colon) === ":" && e8.bufferSubstringNoProperties(Math.max(s.start, s.content - 5), s.content) !== " (t)\n") {
    const text = e8.propertize(` (${s.children.length})`, { "font-lock-face": "magit-section-child-count" });
    const at = e8.point();
    e8.deleteRegion(colon, colon + 1);
    e8.gotoChar(colon);
    e8.insert(text);
    const delta = String(text).length - 1;
    e8.gotoChar(at + delta);
    shift(colon + 1, delta, [...new Set([...(insertion?.made ?? []), s])]);
  } else if (e8.bufferSubstringNoProperties(Math.max(s.start, s.content - 5), s.content) === " (t)\n") {
    const t = s.content - 3;
    const count = String(s.children.length);
    const at = e8.point();
    e8.deleteRegion(t, t + 1);
    e8.gotoChar(t);
    e8.insert(count);
    const delta = count.length - 1;
    e8.gotoChar(at + delta);
    shift(t + 1, delta, [...new Set([...(insertion?.made ?? []), s])]);
  }
}

/** Inserts the section's body with BODY now if it is shown, else the first time it is shown, as magit-insert-section-body. */
export function magitInsertSectionBody(body: () => void): void {
  const s = insertion?.stack[insertion.stack.length - 1];
  if (!s || !s.hidden) return body();
  s.washer = body;
}

/** Calls FN until it gives false or the buffer ends, as magit-wash-sequence. */
export function magitWashSequence(fn: () => boolean): void {
  while (e8.point() < e8.pointMax() && fn()) {
    // Washers move point forward.
  }
}

/** Runs a deferred body, inserting it at the section's end, as magit-section--opportunistic-wash. */
function wash(s: Section): void {
  const washer = s.washer;
  const tree = sections();
  if (!washer || !tree) return;
  s.washer = undefined;
  e8.letBind({ "inhibit-read-only": true }, () =>
    e8.saveExcursion(() => {
      const at = s.end;
      e8.gotoChar(at);
      const before = e8.pointMax();
      const outer = insertion;
      insertion = { stack: magitSectionLineage(s, true).reverse(), made: [] };
      let made: Section[] = [];
      try {
        washer();
      } finally {
        made = insertion.made;
        insertion = outer;
      }
      const delta = e8.pointMax() - before;
      const lineage = new Set(magitSectionLineage(s, true));
      for (const x of tree.all) {
        if (lineage.has(x)) x.end += delta;
        else if (x.start >= at) {
          x.start += delta;
          x.content += delta;
          x.end += delta;
        }
      }
      tree.root.end = e8.pointMax();
      const descendants: Section[] = [];
      const walk = (x: Section) => {
        for (const c of x.children) {
          descendants.push(c);
          walk(c);
        }
      };
      walk(s);
      const others = tree.all.filter((x) => !descendants.includes(x));
      others.splice(others.indexOf(s) + 1, 0, ...descendants);
      tree.all = others;
      for (const x of made) {
        setSectionProperties(x);
        applyVisibility(x);
      }
    }),
  );
  e8.setBufferModified(false);
  highlightForce = true;
}

/** Puts a section type's keymap on its text, as magit-section--set-section-properties. */
function setSectionProperties(s: Section): void {
  const name = types.get(s.type)?.keymap;
  if (!name) return;
  const keymap = (e8.variable(name) ?? name) as e8.Value;
  e8.withSilentModifications(() => {
    if (s.children.length === 0) e8.putTextProperty(s.start, s.end, "keymap", keymap);
    else e8.putTextProperty(s.start, s.content, "keymap", keymap);
  });
}

// The tree.

/** The sections of the current buffer, root first. */
export function sections(): Tree | undefined {
  return roots.get(e8.currentBuffer());
}

/** The buffer's root section, as magit-root-section. */
export const magitRootSection = (): Section | undefined => sections()?.root;

/** Whether S shows: none of its parents is hidden. */
export const visibleP = (s: Section): boolean => {
  for (let p = s.parent; p; p = p.parent) if (p.hidden) return false;
  return true;
};

/** Whether S or an ancestor is hidden, as magit-section-hidden. */
export const magitSectionHidden = (s: Section): boolean => s.hidden || (s.parent !== undefined && magitSectionHidden(s.parent));

/** Whether S has content, or a body to insert yet, as magit-section-content-p. */
export const magitSectionContentP = (s: Section): boolean => s.heading === true && (s.content !== s.end || s.washer !== undefined);

/** Whether the content of S or of any child is hidden, as magit-section-hidden-body. */
export function magitSectionHiddenBody(s: Section, every = false): boolean {
  if (s.children.length > 0) return every ? s.children.every((c) => magitSectionHiddenBody(c, every)) : s.children.some((c) => magitSectionHiddenBody(c, every));
  return s.heading === true && s.hidden;
}

/** The innermost section at POS that shows, as magit-section-at; the root where no other is. */
export function sectionAt(pos = e8.point()): Section | undefined {
  const tree = sections();
  if (!tree) return undefined;
  let found: Section | undefined;
  for (const s of tree.all) {
    if (s.start > pos) break;
    if (pos < Math.max(s.end, s.start + 1) && visibleP(s)) found = s;
  }
  return found ?? tree.root;
}

/** The section point is in, as magit-current-section. */
export const currentSection = (): Section | undefined => sectionAt();

/** Whether POS is in the heading of SECTION, as magit-section-position-in-heading-p. */
export function magitSectionPositionInHeadingP(section = currentSection(), pos = e8.point()): boolean {
  return section !== undefined && pos >= section.start && pos < (section.heading ? section.content : section.end);
}

// Visibility.

/** Hides or shows a section's content with an invisible overlay, and its indicator. */
function applyVisibility(s: Section): void {
  if (s.overlay !== undefined) e8.deleteOverlay(s.overlay);
  s.overlay = undefined;
  if (s.hidden && s.end > s.content) {
    s.overlay = e8.makeOverlay(s.content, s.end, { invisible: true, "magit-section": true, evaporate: true });
  }
  updateIndicator(s);
}

/** Shows whether S can be expanded or collapsed, in the fringe or after the heading, as magit-section-maybe-update-visibility-indicator. */
function updateIndicator(s: Section): void {
  if (s.indicator !== undefined) e8.deleteOverlay(s.indicator);
  s.indicator = undefined;
  const indicator = e8.variable("magit-section-visibility-indicator");
  if (!Array.isArray(indicator) || !magitSectionContentP(s)) return;
  const [hidden, shown] = indicator as unknown[];
  if (typeof hidden === "string" && hidden.startsWith("magit-fringe-bitmap")) {
    if (!e8.displayGraphicP()) return;
    const bitmap = String(s.hidden ? hidden : shown);
    s.indicator = e8.makeOverlay(s.start, s.start, { "magit-section": true, "before-string": e8.propertize("fringe", { display: ["left-fringe", bitmap, "fringe"] }) });
  } else if (typeof hidden === "string" && s.hidden) {
    const eol = e8.lineEnd(e8.lineOf(s.start));
    s.indicator = e8.makeOverlay(eol, eol, { "magit-section": true, "after-string": hidden });
  }
}

/** Remembers S's visibility, as magit-section-maybe-cache-visibility. */
function cacheVisibility(s: Section): void {
  const setting = e8.variable("magit-section-cache-visibility");
  if (setting === true || (Array.isArray(setting) && (setting as string[]).includes(s.type))) {
    const buffer = e8.currentBuffer();
    const cache = visibilityCache.get(buffer) ?? new Map<string, "show" | "hide">();
    cache.set(identKey(s), s.hidden ? "hide" : "show");
    visibilityCache.set(buffer, cache);
  }
}

/** Shows S's content, and its children as they were, as magit-section-show. */
export function show(s: Section): void {
  s.hidden = false;
  wash(s);
  applyVisibility(s);
  cacheVisibility(s);
  highlightForce = true;
  for (const c of s.children) {
    if (c.hidden) hide(c);
    else show(c);
  }
}

/** Hides S's content, as magit-section-hide. */
export function hide(s: Section): void {
  if (!s.parent) e8.userError("Cannot hide root section");
  s.hidden = true;
  // Point in the body goes to the heading; Emacs would move it out of the hidden text.
  if (s.heading && s.content <= e8.point() && e8.point() < s.end) e8.gotoChar(s.start);
  applyVisibility(s);
  cacheVisibility(s);
  highlightForce = true;
}

/** Shows S, or for the root its children as they now are. */
function showOrRoot(s: Section): void {
  if (s.parent) show(s);
  else for (const c of s.children) c.hidden ? hide(c) : show(c);
}

/** Shows the bodies of S's children, to DEPTH and hiding deeper ones, as magit-section-show-children. */
export function magitSectionShowChildren(s: Section, depth?: number): void {
  const walk = (x: Section, d?: number) => {
    for (const c of x.children) {
      c.hidden = false;
      if (d !== undefined) {
        if (d > 0) walk(c, d - 1);
        else c.hidden = true;
      } else walk(c);
    }
  };
  walk(s, depth);
  showOrRoot(s);
}

/** Hides the bodies of S's children, as magit-section-hide-children. */
export const magitSectionHideChildren = (s: Section): void => s.children.forEach(hide);

/** Shows S's children, and theirs where they have any, as magit-section-show-headings. */
export function magitSectionShowHeadings(s: Section): void {
  const walk = (x: Section) => {
    for (const c of x.children) {
      c.hidden = false;
      if (c.children.length > 0 || !c.heading) walk(c);
    }
  };
  walk(s);
  showOrRoot(s);
}

/** Moves to a section, or ARG lines, and runs the movement hook, as magit-section-goto. */
export function magitSectionGoto(arg: Section | number): void {
  let s: Section | undefined;
  if (typeof arg === "number") {
    forwardLine(arg);
    s = currentSection();
  } else {
    e8.gotoChar(arg.start);
    s = arg;
  }
  e8.runHooks("magit-section-movement-hook", s as unknown as e8.Value);
}

/** Moves point to S's heading. */
export function gotoSection(s: Section): void {
  e8.gotoChar(s.start);
}

/** Makes S show: its ancestors shown, as magit-section-reveal. */
export function magitSectionReveal(s: Section): void {
  for (let p = s.parent; p && p.parent; p = p.parent) if (p.hidden) show(p);
}

/** Shows the sections around point to LEVEL, or all of them for a negative LEVEL, as magit-section-show-level. */
export function magitSectionShowLevel(level: number): void {
  const tree = sections();
  if (!tree) return;
  if (level < 0) {
    let s = currentSection() ?? tree.root;
    const abs = -level;
    while (magitSectionIdent(s).length - 1 > abs && s.parent) {
      s = s.parent;
      e8.gotoChar(s.start);
    }
    magitSectionShowChildren(tree.root, abs - 1);
    return;
  }
  for (const section of magitRegionSections() ?? [currentSection() ?? tree.root]) {
    let s: Section | undefined = section;
    let i = magitSectionIdent(section).length - 1;
    for (;;) {
      if (i < level) {
        magitSectionShowChildren(s!, level - i - 1);
        break;
      }
      if (i === level) {
        hide(s!);
        break;
      }
      s = s!.parent;
      i--;
      magitSectionGoto(s!);
    }
  }
}

// The region.

const regionActiveP = (): boolean => e8.regionActive() && e8.mark() !== undefined;

/**
 * The sibling sections the region selects, as magit-region-sections: it
 * must start in a section's heading and end in the heading of that one or
 * a later sibling; with MULTIPLE in another one. With CONDITION, every one
 * must match.
 */
export function magitRegionSections(condition?: SectionCondition, multiple = false): Section[] | undefined {
  if (!regionActiveP()) return undefined;
  const rbeg = Math.min(e8.mark()!, e8.point());
  const rend = Math.max(e8.mark()!, e8.point());
  const sbeg = sectionAt(rbeg);
  const send = sectionAt(rend);
  if (!send || !send.parent || !sbeg) return undefined;
  if (send === sbeg && (multiple || rend > rbeg)) return undefined;
  const siblings = [sbeg, ...magitSectionSiblings(sbeg, "next")];
  if (!siblings.includes(send) || !magitSectionPositionInHeadingP(sbeg, rbeg) || !magitSectionPositionInHeadingP(send, rend)) return undefined;
  const selected = siblings.slice(0, siblings.indexOf(send) + 1);
  if (condition !== undefined && !selected.every((s) => magitSectionMatch(condition, s))) return undefined;
  return selected;
}

/** The values of the sections the region selects, as magit-region-values. */
export const magitRegionValues = (condition?: SectionCondition, multiple = false): unknown[] | undefined => magitRegionSections(condition, multiple)?.map((s) => s.value);

/** Whether the region is inside SECTION's body, as magit-section-internal-region-p. */
export function magitSectionInternalRegionP(section = currentSection()): boolean {
  if (!regionActiveP() || !section) return false;
  const beg = Math.min(e8.mark()!, e8.point());
  const end = Math.max(e8.mark()!, e8.point());
  return sectionAt(beg) === section && sectionAt(end) === section && !magitSectionPositionInHeadingP(section, beg) && !magitSectionPositionInHeadingP(section, end);
}

/** The sections selected, or the current one, with their descendants, as magit-focused-sections. */
export function magitFocusedSections(): Section[] {
  const at = currentSection();
  if (!at || !at.parent) return [];
  const out: Section[] = [];
  const collect = (s: Section) => {
    s.children.forEach(collect);
    out.push(s);
  };
  (magitRegionSections() ?? [at]).forEach(collect);
  return out;
}

// Highlighting.

/** The highlight's overlays and what they were for, as magit-section-highlight-overlays. */
interface Highlight {
  buffer: e8.Buffer;
  overlays: number[];
  section?: Section;
  regionKey: string;
  painted: Set<Section>;
}
const highlights = new PerBuffer<Highlight>();
let highlightForce = false;

function deleteHighlight(): void {
  const h = highlights.get(e8.currentBuffer());
  if (!h) return;
  h.overlays.forEach((o) => e8.deleteOverlay(o));
  h.overlays = [];
}

/** Highlights START to END in FACE, as magit-section-highlight-range. */
function highlightRange(h: Highlight, start: number, end: number, face = "magit-section-highlight"): void {
  if (end <= start) return;
  h.overlays.push(e8.makeOverlay(start, end, { face, "magit-section": true, priority: -1, evaporate: true }));
}

/** Whether only parts of S are highlighted, as magit-section-selective-highlight-p. */
function selectiveHighlightP(s: Section, asChild = false): boolean {
  const t = types.get(s.type);
  if (t?.selectiveHighlight) return true;
  if (asChild && t?.headingHighlightFace) return true;
  if (t?.paint) return true;
  return s.children.length > 0 && selectiveHighlightP(s.children[0], true);
}

/** Highlights S, as magit-section-highlight. */
function highlightSection(h: Highlight, s: Section): void {
  const headlight = types.get(s.type)?.headingHighlightFace;
  const content = s.heading ? s.content : undefined;
  if (selectiveHighlightP(s)) {
    highlightRange(h, s.start, content ?? s.end, headlight);
    if (s.children.length > 0) {
      const childStart = s.children[0].start;
      if (content !== undefined && content < childStart) highlightRange(h, content, childStart);
      s.children.forEach((c) => highlightSection(h, c));
    } else if (content !== undefined && !types.get(s.type)?.paint) highlightRange(h, content, s.end);
  } else if (headlight) {
    highlightRange(h, s.start, content ?? s.end, headlight);
    if (content !== undefined) highlightRange(h, content, s.end);
  } else highlightRange(h, s.start, s.end);
}

/** Highlights the headings of the selected sections, as magit-section-highlight-selection. */
function highlightSelection(h: Highlight, selection: Section[]): void {
  if (!truthy(e8.variable("magit-section-highlight-selection"))) return;
  for (const s of selection) {
    const face = types.get(s.type)?.headingSelectionFace ?? "magit-section-heading-selection";
    h.overlays.push(e8.makeOverlay(s.start, s.heading ? s.content : s.end, { face, "magit-section": true, priority: 9, evaporate: true }));
  }
}

/** Paints a painted section highlighted when focused and plainly when not, as magit-section-update-paint. */
function updatePaint(h: Highlight, s: Section, focused: Section[]): void {
  const paint = types.get(s.type)?.paint;
  if (!paint) return;
  if (magitSectionHidden(s)) return;
  const isFocused = focused.includes(s);
  const now = s.painted;
  const doPaint = (on: boolean) => e8.letBind({ "inhibit-read-only": true }, () => e8.saveExcursion(() => e8.withSilentModifications(() => paint(s, on))));
  if (isFocused && now !== "highlight") {
    doPaint(true);
    s.painted = "highlight";
  } else if (!isFocused && now !== "plain") {
    doPaint(false);
    s.painted = "plain";
  }
  if (s.painted === "highlight") h.painted.add(s);
}

/** Highlights the current section or the selected ones, after each command, as magit-section-update-highlight. */
export function magitSectionUpdateHighlight(force = false): void {
  const tree = sections();
  if (!tree) return;
  const buffer = e8.currentBuffer();
  const section = currentSection();
  const selection = magitRegionSections();
  const regionKey = selection ? selection.map(identKey).join("|") : regionActiveP() ? "active" : "";
  const old = highlights.get(buffer);
  if (old && old.section === section && old.regionKey === regionKey && !force && !highlightForce) return;
  highlightForce = false;
  deleteHighlight();
  const h: Highlight = { buffer, overlays: [], section, regionKey, painted: new Set() };
  highlights.set(buffer, h);
  if (section && section.parent) {
    if (!truthy(e8.variable("magit-section-highlight-current"))) {
      if (selection) highlightSelection(h, selection);
    } else if (!selection) highlightSection(h, section);
    else {
      selection.forEach((s) => highlightSection(h, s));
      highlightSelection(h, selection);
    }
  }
  const focused = magitFocusedSections();
  // Sections not painted yet are painted plainly, as Magit paints them after a refresh or when shown.
  const unpainted = tree.all.filter((s) => s.painted === undefined && types.get(s.type)?.paint !== undefined && !magitSectionHidden(s));
  const candidates = new Set([...(old?.painted ?? []), ...focused, ...unpainted]);
  for (const s of candidates) if (tree.all.includes(s)) updatePaint(h, s, focused);
}

// Describing.

/** A section described in a line: its value, lineage and where it is, as magit-describe-section-briefly. */
export function magitDescribeSectionBriefly(s = currentSection(), ident = false): string {
  if (!s) return "";
  const v = typeof s.value === "string" ? JSON.stringify(s.value) : s.value === undefined ? "nil" : JSON.stringify(magitSectionIdentValue(s));
  const lineage = ident ? JSON.stringify(magitSectionIdent(s)) : `[${magitSectionLineage(s).join(" ")}]`;
  return `#<magit-section ${v} ${lineage} ${s.start}-${s.heading ? `[${s.content}-]` : ""}${s.end}>`;
}

// Commands.

const err = (msg: string): never => e8.userError(msg);

/** The same keys in each mode built on magit-section-mode, as magit-section-mode-map. */
export const sectionCommands = {
  toggle: e8.defineCommand({
    name: "magit-section-toggle",
    doc: "Toggle visibility of the body of the current section.",
    run: () => {
      const s = currentSection();
      if (!s || !s.parent) return err("Cannot hide root section");
      if (s.hidden) show(s);
      else hide(s);
    },
  }),
  toggleChildren: e8.defineCommand({
    name: "magit-section-toggle-children",
    doc: "Toggle visibility of bodies of children of the current section.",
    run: () => {
      const s = currentSection();
      if (!s) return;
      const showThem = s.children.some((c) => c.hidden);
      for (const c of s.children) c.hidden = !showThem;
      showOrRoot(s);
    },
  }),
  showChildren: e8.defineCommand({
    name: "magit-section-show-children",
    doc: "Recursively show the bodies of children of the current section; with a prefix argument, that deep.",
    params: [{ name: "depth", kind: "prefix" }],
    run: (depth: e8.Value) => {
      const s = currentSection();
      if (s) magitSectionShowChildren(s, typeof depth === "number" ? depth : undefined);
    },
  }),
  hideChildren: e8.defineCommand({
    name: "magit-section-hide-children",
    doc: "Recursively hide the bodies of children of the current section.",
    run: () => {
      const s = currentSection();
      if (s) magitSectionHideChildren(s);
    },
  }),
  showHeadings: e8.defineCommand({
    name: "magit-section-show-headings",
    doc: "Recursively show headings of children of the current section, hiding text-only bodies.",
    run: () => {
      const s = currentSection();
      if (s) magitSectionShowHeadings(s);
    },
  }),
  forward: e8.defineCommand({
    name: "magit-section-forward",
    doc: "Move to the beginning of the next visible section.",
    run: () => {
      if (e8.point() >= e8.pointMax()) return err("No next section");
      let s = currentSection();
      if (!s) return err("No next section");
      if (!s.parent) return magitSectionGoto(1);
      let next = !s.hidden && s.end !== e8.point() + 1 ? s.children[0] : undefined;
      while (s && !next) {
        next = magitSectionSiblings(s, "next")[0];
        if (!next) s = s.parent;
      }
      if (!next) return err("No next section");
      magitSectionGoto(next);
    },
  }),
  backward: e8.defineCommand({
    name: "magit-section-backward",
    doc: "Move to the beginning of the current section, or if that is already the case, the previous visible section.",
    run: () => {
      if (e8.point() <= e8.pointMin()) return err("No previous section");
      const s = currentSection();
      if (!s) return err("No previous section");
      if (e8.point() === s.end - 1 && s.children.length > 0 && !s.hidden) return magitSectionGoto(s.children[s.children.length - 1]);
      if (s.parent && e8.point() !== s.start) return magitSectionGoto(s);
      let prev: Section | undefined = magitSectionSiblings(s, "prev")[0];
      if (prev) {
        while (!prev.hidden && prev.children.length > 0) prev = prev.children[prev.children.length - 1];
      } else prev = s.parent;
      if (prev && prev.parent) return magitSectionGoto(prev);
      if (s.parent) return err("No previous section");
      return magitSectionGoto(-1);
    },
  }),
  up: e8.defineCommand({
    name: "magit-section-up",
    doc: "Move to the beginning of the parent section.",
    run: () => {
      const parent = currentSection()?.parent;
      if (!parent || !parent.parent) return err("No parent section");
      magitSectionGoto(parent);
    },
  }),
  forwardSibling: e8.defineCommand({
    name: "magit-section-forward-sibling",
    doc: "Move to the beginning of the next sibling section, or if there is none, the next section.",
    run: () => {
      const s = currentSection();
      if (!s || !s.parent) return magitSectionGoto(1);
      const next = magitSectionSiblings(s, "next")[0];
      if (next) magitSectionGoto(next);
      else e8.call("magit-section-forward" as e8.CommandName);
    },
  }),
  backwardSibling: e8.defineCommand({
    name: "magit-section-backward-sibling",
    doc: "Move to the beginning of the previous sibling section, or if there is none, the previous section.",
    run: () => {
      const s = currentSection();
      if (!s || !s.parent) return magitSectionGoto(-1);
      const prev = magitSectionSiblings(s, "prev")[0];
      if (prev) magitSectionGoto(prev);
      else e8.call("magit-section-backward" as e8.CommandName);
    },
  }),
  cycle: e8.defineCommand({
    name: "magit-section-cycle",
    doc: "Cycle the visibility of the current section and its children.",
    run: () => {
      const s = currentSection();
      if (!s || !s.parent) return e8.call("magit-section-cycle-global" as e8.CommandName);
      if (s.hidden) {
        show(s);
        magitSectionHideChildren(s);
      } else if (s.children.some((c) => c.hidden) && s.children.some((c) => c.children.length > 0)) magitSectionShowHeadings(s);
      else if (s.children.some((c) => magitSectionHiddenBody(c))) magitSectionShowChildren(s);
      else hide(s);
    },
  }),
  cycleGlobal: e8.defineCommand({
    name: "magit-section-cycle-global",
    doc: "Cycle the visibility of all sections in the current buffer.",
    run: () => {
      const root = sections()?.root;
      if (!root) return;
      const children = root.children;
      if (children.some((c) => c.hidden) && children.some((c) => c.children.length > 0)) magitSectionShowHeadings(root);
      else if (children.some((c) => magitSectionHiddenBody(c))) magitSectionShowChildren(root);
      else children.forEach(hide);
    },
  }),
  describeBriefly: e8.defineCommand({
    name: "magit-describe-section-briefly",
    doc: "Show information about the section at point; with a prefix argument, its identity rather than its lineage.",
    params: [{ name: "ident", kind: "prefix" }],
    run: (ident: e8.Value) => e8.message(magitDescribeSectionBriefly(currentSection(), truthy(ident))),
  }),
  describe: e8.defineCommand({
    name: "magit-describe-section",
    doc: "Show information about the section at point: what it is and what inserted it.",
    run: () => {
      let s = currentSection();
      while (s && !s.inserter) s = s.parent;
      if (!s?.inserter) return e8.message(`${magitDescribeSectionBriefly(currentSection())}, inserter unknown`);
      e8.message(`${magitDescribeSectionBriefly(s)}\n  is inserted by \`${s.inserter}'`);
    },
  }),
};

const levels = [1, 2, 3, 4].map((n) => e8.defineCommand({ name: `magit-section-show-level-${n}`, doc: `Show surrounding sections up to level ${n}.`, run: () => magitSectionShowLevel(n) }));
const levelsAll = [1, 2, 3, 4].map((n) => e8.defineCommand({ name: `magit-section-show-level-${n}-all`, doc: `Show all sections up to level ${n}.`, run: () => magitSectionShowLevel(-n) }));

export const magitSectionMode = e8.defineMajorMode({
  name: "magit-section-mode",
  modeName: "Magit-Sections",
  parent: "special-mode",
  doc: "Parent major mode of buffers made of sections, as Magit's are.",
  bindings: {
    TAB: sectionCommands.toggle,
    "C-c TAB": sectionCommands.cycle,
    "C-<tab>": sectionCommands.cycle,
    "M-<tab>": sectionCommands.cycle,
    "<backtab>": sectionCommands.cycleGlobal,
    "S-<tab>": sectionCommands.cycleGlobal,
    "^": sectionCommands.up,
    p: sectionCommands.backward,
    n: sectionCommands.forward,
    "M-p": sectionCommands.backwardSibling,
    "M-n": sectionCommands.forwardSibling,
    "1": levels[0],
    "2": levels[1],
    "3": levels[2],
    "4": levels[3],
    "M-1": levelsAll[0],
    "M-2": levelsAll[1],
    "M-3": levelsAll[2],
    "M-4": levelsAll[3],
  },
  setup: () => {
    for (const [name, value] of [
      ["truncate-lines", true],
      ["buffer-read-only", true],
    ] as const) {
      e8.makeLocalVariable(name);
      e8.setVariable(name, value);
    }
    e8.addHook("post-command-hook", () => magitSectionUpdateHighlight(), { local: true });
  },
});
