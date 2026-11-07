// SPDX-License-Identifier: GPL-3.0-or-later
//
// magit-section's tests, with ERT: sections inserted into a buffer of a
// mode built on magit-section-mode, hidden and shown with TAB, cycled and
// shown to a level, and moved between with n, p, M-n, M-p and ^.
// `make test` runs them in e8 --batch, as CI does.

import { ertDeftest, should, shouldEqual, shouldError } from "ert";
import {
  currentSection,
  insertHeading,
  insertRoot,
  insertSection,
  magitCancelSection,
  magitDescribeSectionBriefly,
  magitGetSection,
  magitInsertSectionBody,
  magitRegionSections,
  magitSectionDefineType,
  magitSectionIdent,
  magitSectionMatch,
  magitSectionMode,
  magitSectionSiblings,
  sections,
  show,
  type Section,
} from "magit-section";

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
  // Headings take magit-section-heading, as font-lock-face, as Magit's do.
  shouldEqual(e8.getTextProperty(0, "font-lock-face"), "magit-section-heading");
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
  // 1 to 4 act on the sections around point: at Alpha, level 1 hides it.
  e8.executeKbdMacro("1");
  shouldEqual(visible(), "Alpha\nBeta\n  b\nGamma\n");
  e8.executeKbdMacro("2");
  shouldEqual(visible(), "Alpha\nAlpha one\nAlpha two\nBeta\n  b\nGamma\n");
  e8.executeKbdMacro("3");
  shouldEqual(visible(), "Alpha\nAlpha one\n  x\nAlpha two\n  y\nBeta\n  b\nGamma\n");
  // From a child, level 1 goes up to its section and hides it.
  e8.executeKbdMacro("n 1");
  shouldEqual([visible(), here()], ["Alpha\nBeta\n  b\nGamma\n", "Alpha"]);
  // M-1 to M-4 act on all of them.
  e8.executeKbdMacro("M-1");
  shouldEqual(visible(), "Alpha\nBeta\nGamma\n");
  e8.executeKbdMacro("M-2");
  shouldEqual(visible(), "Alpha\nAlpha one\nAlpha two\nBeta\n  b\nGamma\n  c\n");
  e8.executeKbdMacro("M-3");
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

/** Makes a buffer of its own in the test mode and inserts sections with BODY. */
function buffer(name: string, body: () => void): void {
  e8.call("switch-to-buffer", name);
  e8.call(testMode);
  e8.letBind({ "inhibit-read-only": true }, () => insertRoot("root", body));
  e8.gotoChar(e8.pointMin());
}

ertDeftest("magit-section-identities-find-a-section-again", () => {
  setup("ms10");
  const two = sections()!.all.find((s) => s.value === "two")!;
  shouldEqual(magitSectionIdent(two), [["item", "two"], ["group", "alpha"], ["root", undefined]]);
  shouldEqual(magitGetSection(magitSectionIdent(two)), two);
  shouldEqual(magitGetSection([["item", "three"], ["group", "alpha"], ["root", undefined]]), undefined);
  // A section made again is found by the same identity.
  insertTestSections();
  shouldEqual(magitGetSection(magitSectionIdent(two))?.start, two.start);
  shouldEqual(magitSectionSiblings(sections()!.all[1], "next").map((s) => s.value), ["two"]);
  should(magitSectionMatch("item", sections()!.all[1]));
  should(magitSectionMatch({ lineage: ["item", "group"] }, sections()!.all[1]));
  should(!magitSectionMatch({ lineage: ["item", "root"] }, sections()!.all[1]));
  should(magitSectionMatch(["nothing", "group"], sections()!.all[0]));
  shouldEqual(magitDescribeSectionBriefly(sections()!.all[0]), `#<magit-section "alpha" [group root] 0-[6-]${ALL.indexOf("Beta")}>`);
});

ertDeftest("magit-section-an-empty-section-can-be-cancelled", () => {
  buffer("ms11", () => {
    insertSection("group", "kept", false, () => {
      insertHeading("Kept");
      e8.insert("  k\n");
    });
    insertSection("group", "empty", false, () => {
      insertHeading("Empty");
      magitCancelSection(true);
    });
    insertSection("group", "full", false, () => {
      insertHeading("Full");
      e8.insert("  f\n");
      magitCancelSection(true);
    });
  });
  shouldEqual(e8.bufferText(), "Kept\n  k\nFull\n  f\n");
  shouldEqual(sections()!.root.children.map((s) => s.value), ["kept", "full"]);
});

ertDeftest("magit-section-child-counts-follow-magits-two-forms", () => {
  buffer("ms12", () => {
    insertSection("group", "colon", false, () => {
      insertHeading("Colon:");
      for (const v of ["a", "b"]) insertSection("item", v, false, () => insertHeading(`  ${v}`));
    });
    insertSection("group", "t", false, () => {
      insertHeading(true, "Tee");
      for (const v of ["c", "d", "e"]) insertSection("item", v, false, () => insertHeading(`  ${v}`));
    });
    insertSection("group", "n", false, () => insertHeading(7, "Number"));
  });
  shouldEqual(e8.bufferText(), "Colon (2)\n  a\n  b\nTee (3)\n  c\n  d\n  e\nNumber (7)\n");
  // " (N)" in magit-section-child-count, except a t's number, which Magit leaves plain.
  shouldEqual(e8.getTextProperty("Colon (".length, "font-lock-face"), "magit-section-child-count");
  const tee = e8.bufferText().indexOf("(3)");
  shouldEqual([e8.getTextProperty(tee, "font-lock-face"), e8.getTextProperty(tee + 1, "font-lock-face")], ["magit-section-child-count", undefined]);
  // The sections after a count moved with it.
  shouldEqual(sections()!.all.map((s) => e8.lineText(e8.lineOf(s.start))), ["Colon (2)", "  a", "  b", "Tee (3)", "  c", "  d", "  e", "Number (7)"]);
});

ertDeftest("magit-section-a-hidden-sections-body-is-inserted-when-shown", () => {
  let washed = 0;
  buffer("ms13", () => {
    insertSection("group", "lazy", true, () => {
      insertHeading("Lazy");
      magitInsertSectionBody(() => {
        washed++;
        insertSection("item", "inner", false, () => {
          insertHeading("  inner");
          e8.insert("    body\n");
        });
      });
    });
    insertSection("group", "after", false, () => {
      insertHeading("After");
      e8.insert("  a\n");
    });
  });
  shouldEqual([e8.bufferText(), washed], ["Lazy\nAfter\n  a\n", 0]);
  e8.executeKbdMacro("TAB");
  shouldEqual([e8.bufferText(), washed], ["Lazy\n  inner\n    body\nAfter\n  a\n", 1]);
  shouldEqual(sections()!.all.map((s) => s.value), ["lazy", "inner", "after"]);
  // The section after it moved down, and n finds them in order.
  e8.executeKbdMacro("n");
  shouldEqual(here(), "  inner");
  e8.executeKbdMacro("n");
  shouldEqual(here(), "After");
  e8.executeKbdMacro("M-p TAB TAB");
  shouldEqual(washed, 1);
});

ertDeftest("magit-section-the-region-selects-sibling-sections", () => {
  setup("ms14");
  e8.gotoChar(ALL.indexOf("Alpha one"));
  e8.setMark(e8.point());
  e8.activateMark();
  e8.gotoChar(ALL.indexOf("Alpha two") + 2);
  shouldEqual(magitRegionSections()?.map((s) => s.value), ["one", "two"]);
  // Ending in a body selects nothing.
  e8.gotoChar(ALL.indexOf("  y"));
  shouldEqual(magitRegionSections(), undefined);
  // Nor does a region across parents.
  e8.gotoChar(ALL.indexOf("Beta"));
  shouldEqual(magitRegionSections(), undefined);
  e8.deactivateMark();
});

ertDeftest("magit-section-a-type-paints-its-text-when-highlighted", () => {
  const painted: [string, boolean][] = [];
  magitSectionDefineType("painted-test", { paint: (s, on) => painted.push([String(s.value), on]) });
  buffer("ms15", () => {
    for (const v of ["p1", "p2"]) {
      insertSection("painted-test", v, false, () => {
        insertHeading(v);
        e8.insert("  text\n");
      });
    }
  });
  e8.executeKbdMacro("n");
  e8.executeKbdMacro("p");
  // Highlighting happens after a command: n to p2 paints it highlighted and
  // p1 plainly, as sections not painted yet are; p back repaints both.
  shouldEqual(painted, [
    ["p2", true],
    ["p1", false],
    ["p2", false],
    ["p1", true],
  ]);
});

ertDeftest("magit-section-visibility-is-cached-when-a-section-comes-back", () => {
  let withBeta = true;
  const insert = () =>
    e8.letBind({ "inhibit-read-only": true }, () =>
      insertRoot("root", () => {
        insertSection("group", "alpha", false, () => {
          insertHeading("Alpha");
          e8.insert("  a\n");
        });
        if (withBeta)
          insertSection("group", "beta", false, () => {
            insertHeading("Beta");
            e8.insert("  b\n");
          });
      }),
    );
  e8.call("switch-to-buffer", "ms16");
  e8.call(testMode);
  insert();
  e8.gotoChar(e8.bufferText().indexOf("Beta"));
  e8.executeKbdMacro("TAB");
  withBeta = false;
  insert();
  withBeta = true;
  insert();
  shouldEqual(visible(), "Alpha\n  a\nBeta\n");
  void show;
});
