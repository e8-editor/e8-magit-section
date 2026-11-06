// SPDX-License-Identifier: GPL-3.0-or-later
//
// magit-section's tests, with ERT: sections inserted into a buffer of a
// mode built on magit-section-mode, hidden and shown with TAB, cycled and
// shown to a level, and moved between with n, p, M-n, M-p and ^.
// `make test` runs them in e8 --batch, as CI does.

import { ertDeftest, should, shouldEqual, shouldError } from "ert";
import { currentSection, insertHeading, insertRoot, insertSection, magitSectionMode, sections, type Section } from "magit-section";

const testMode = e8.defineMajorMode({
  name: "magit-section-test-mode",
  modeName: "Sections",
  parent: magitSectionMode,
  doc: "A buffer of sections for magit-section's tests.",
});

/** Inserts the test sections: two groups shown, one with two items, and one group hidden at first. */
function insertTestSections(): Section {
  return e8.letBind({ "inhibit-read-only": true }, () =>
    insertRoot("root", () => {
      insertSection("group", "alpha", false, () => {
        insertHeading("Alpha");
        insertSection("item", "one", false, () => {
          insertHeading("Alpha one");
          e8.insert("  x\n");
        });
        insertSection("item", "two", false, () => {
          insertHeading("Alpha two");
          e8.insert("  y\n");
        });
      });
      insertSection("group", "beta", false, () => {
        insertHeading("Beta");
        e8.insert("  b\n");
      });
      insertSection("group", "gamma", true, () => {
        insertHeading("Gamma");
        e8.insert("  c\n");
      });
    }),
  );
}

const ALL = "Alpha\nAlpha one\n  x\nAlpha two\n  y\nBeta\n  b\nGamma\n  c\n";

/** A buffer of its own, in the test mode, with the test sections and point on the first. */
function setup(name: string): void {
  e8.call("switch-to-buffer", name);
  e8.call(testMode);
  insertTestSections();
  e8.gotoChar(e8.pointMin());
}

/** The buffer's text as it shows, hidden sections left out. */
function visible(): string {
  const hidden = e8.overlaysIn(e8.pointMin(), e8.pointMax()).filter((o) => e8.overlayGet(o, "invisible") === true);
  let out = "";
  for (let p = e8.pointMin(); p < e8.pointMax(); p++) {
    if (!hidden.some((o) => (e8.overlayStart(o) ?? 0) <= p && p < (e8.overlayEnd(o) ?? 0))) out += e8.charAfter(p);
  }
  return out;
}

/** The text of the line point is on. */
const here = (): string => e8.lineText(e8.lineOf(e8.point()));

ertDeftest("magit-section-inserting-makes-a-tree-of-sections", () => {
  setup("ms1");
  shouldEqual(e8.bufferText(), ALL);
  const tree = sections();
  should(tree !== undefined, "the buffer has sections");
  const names = (s: Section): unknown[] => s.children.map((c) => (c.children.length ? [c.value, names(c)] : c.value));
  shouldEqual(names(tree!.root), [["alpha", ["one", "two"]], "beta", "gamma"]);
  shouldEqual(
    tree!.all.map((s) => s.value),
    ["alpha", "one", "two", "beta", "gamma"],
  );
  // A section runs from its heading to the next; its content starts after the heading line.
  const alpha = tree!.all[0];
  shouldEqual([alpha.start, alpha.content, alpha.end], [0, "Alpha\n".length, "Alpha\nAlpha one\n  x\nAlpha two\n  y\n".length]);
  shouldEqual(tree!.all[1].parent, alpha);
  // Headings take magit-section-heading.
  shouldEqual(e8.getTextProperty(0, "face"), "magit-section-heading");
  // The innermost section at point.
  e8.gotoChar(ALL.indexOf("  y"));
  shouldEqual(currentSection()?.value, "two");
  // A section asked to start hidden does.
  shouldEqual(visible(), ALL.replace("  c\n", ""));
  shouldEqual(e8.variable("buffer-read-only"), true);
});

ertDeftest("magit-section-tab-hides-and-shows-a-section", () => {
  setup("ms2");
  e8.executeKbdMacro("TAB");
  shouldEqual(visible(), "Alpha\nBeta\n  b\nGamma\n");
  e8.executeKbdMacro("TAB");
  shouldEqual(visible(), "Alpha\nAlpha one\n  x\nAlpha two\n  y\nBeta\n  b\nGamma\n");
  // Hiding from within the content takes point to the heading.
  e8.gotoChar(ALL.indexOf("  b"));
  e8.executeKbdMacro("TAB");
  shouldEqual(here(), "Beta");
  shouldEqual(visible(), "Alpha\nAlpha one\n  x\nAlpha two\n  y\nBeta\nGamma\n");
  e8.gotoChar(ALL.indexOf("Gamma"));
  e8.executeKbdMacro("TAB");
  shouldEqual(visible(), "Alpha\nAlpha one\n  x\nAlpha two\n  y\nBeta\nGamma\n  c\n");
});

ertDeftest("magit-section-n-and-p-move-between-the-sections-that-show", () => {
  setup("ms3");
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    e8.executeKbdMacro("n");
    seen.push(here());
  }
  shouldEqual(seen, ["Alpha one", "Alpha two", "Beta", "Gamma"]);
  shouldEqual(shouldError(() => e8.executeKbdMacro("n"), { type: "user-error" }).message, "No next section");
  e8.executeKbdMacro("p p");
  shouldEqual(here(), "Alpha two");
  // p within a section's content goes to its heading first.
  e8.gotoChar(ALL.indexOf("  x") + 1);
  e8.executeKbdMacro("p");
  shouldEqual([here(), e8.point()], ["Alpha one", ALL.indexOf("Alpha one")]);
  e8.executeKbdMacro("p");
  shouldEqual(here(), "Alpha");
  shouldEqual(shouldError(() => e8.executeKbdMacro("p"), { type: "user-error" }).message, "No previous section");
  // The children of a hidden section are passed over.
  e8.executeKbdMacro("TAB n");
  shouldEqual(here(), "Beta");
});

ertDeftest("magit-section-siblings-and-the-parent", () => {
  setup("ms4");
  e8.executeKbdMacro("M-n");
  shouldEqual(here(), "Beta");
  e8.executeKbdMacro("M-n");
  shouldEqual(here(), "Gamma");
  e8.executeKbdMacro("M-p M-p");
  shouldEqual(here(), "Alpha");
  e8.executeKbdMacro("n M-n");
  shouldEqual(here(), "Alpha two");
  // The last child has no next sibling: M-n goes on to the next section.
  e8.executeKbdMacro("M-n");
  shouldEqual(here(), "Beta");
  e8.executeKbdMacro("p ^");
  shouldEqual(here(), "Alpha");
  shouldEqual(shouldError(() => e8.executeKbdMacro("^"), { type: "user-error" }).message, "No parent section");
  // magit-section-movement-hook runs after each move.
  let moves = 0;
  const count = () => void moves++;
  e8.addHook("magit-section-movement-hook", count);
  try {
    e8.executeKbdMacro("n n ^");
  } finally {
    e8.removeHook("magit-section-movement-hook", count);
  }
  shouldEqual(moves, 3);
});

ertDeftest("magit-section-1-to-4-show-sections-to-a-level", () => {
  setup("ms5");
  e8.executeKbdMacro("1");
  shouldEqual(visible(), "Alpha\nBeta\nGamma\n");
  e8.executeKbdMacro("2");
  shouldEqual(visible(), "Alpha\nAlpha one\nAlpha two\nBeta\n  b\nGamma\n  c\n");
  e8.executeKbdMacro("3");
  shouldEqual(visible(), ALL);
  e8.executeKbdMacro("1 4");
  shouldEqual(visible(), ALL);
});

ertDeftest("magit-section-cycling", () => {
  setup("ms6");
  // C-<tab> on a section: everything shown, so all hidden; then the
  // children's headings; then everything again.
  e8.executeKbdMacro("C-<tab>");
  shouldEqual(visible(), "Alpha\nBeta\n  b\nGamma\n");
  e8.executeKbdMacro("C-<tab>");
  shouldEqual(visible(), "Alpha\nAlpha one\nAlpha two\nBeta\n  b\nGamma\n");
  e8.executeKbdMacro("C-<tab>");
  shouldEqual(visible(), "Alpha\nAlpha one\n  x\nAlpha two\n  y\nBeta\n  b\nGamma\n");
  // S-<tab>: Gamma is hidden, so every top-level section shows; then all hide.
  e8.executeKbdMacro("S-<tab>");
  shouldEqual(visible(), ALL);
  e8.executeKbdMacro("<backtab>");
  shouldEqual(visible(), "Alpha\nBeta\nGamma\n");
});

ertDeftest("magit-section-visibility-is-kept-when-the-buffer-is-made-again", () => {
  setup("ms7");
  e8.executeKbdMacro("M-n TAB");
  shouldEqual(visible(), "Alpha\nAlpha one\n  x\nAlpha two\n  y\nBeta\nGamma\n");
  insertTestSections();
  shouldEqual(e8.bufferText(), ALL);
  shouldEqual(visible(), "Alpha\nAlpha one\n  x\nAlpha two\n  y\nBeta\nGamma\n");
});

ertDeftest("magit-section-the-initial-visibility-alist-hides-sections-of-a-type", () => {
  e8.call("switch-to-buffer", "ms8");
  e8.call(testMode);
  e8.letBind({ "magit-section-initial-visibility-alist": [["item", "hide"]] }, () => insertTestSections());
  // Gamma, not in the alist, starts hidden as it asks to.
  shouldEqual(visible(), "Alpha\nAlpha one\nAlpha two\nBeta\n  b\nGamma\n");
  e8.call("switch-to-buffer", "ms8b");
  e8.call(testMode);
  e8.letBind({ "magit-section-initial-visibility-alist": [["group", "show"]] }, () => insertTestSections());
  shouldEqual(visible(), ALL);
});

ertDeftest("magit-section-the-current-section-is-highlighted", () => {
  setup("ms9");
  e8.executeKbdMacro("M-n");
  const lit = e8.overlaysIn(e8.pointMin(), e8.pointMax()).filter((o) => e8.overlayGet(o, "face") === "magit-section-highlight");
  shouldEqual(lit.map((o) => [e8.overlayStart(o), e8.overlayEnd(o)]), [[ALL.indexOf("Beta"), ALL.indexOf("Gamma")]]);
});
