# e8-magit-section

Buffers made of nested sections, for [E8](https://github.com/e8-editor/e8): each section is a heading line and its content, which `TAB` hides and shows, and `n`, `p`, `M-n`, `M-p` and `^` move between them. It is what [e8-magit](https://github.com/e8-editor/e8-magit)'s buffers are built from, and other packages can build on it too. A port of Magit's magit-section.el 4.4.0.

## Installing

Most people get it as a requirement of e8-magit, which installs it. To use it on its own, in `~/.config/e8/init.ts`:

```ts
e8.usePackage("e8-editor/e8-magit-section");
```

E8 installs it at its newest version tag into `repos/` beside `init.ts`, records the commit in `e8-lock.json`, and requires it. `M-x package-vc-upgrade` brings it up to date. Pin a version with `{ rev: "v0.2.0" }`. It needs E8 0.3.1 or newer.

## Using it

In a buffer whose major mode derives from `magit-section-mode`:

| Key | Does |
| --- | --- |
| `TAB` | hide or show the content of the section at point |
| `C-<tab>`, `M-<tab>`, `C-c TAB` | cycle the section and its children: hidden, the children's headings, everything |
| `<backtab>`, `S-<tab>` | cycle every top-level section |
| `n`, `p` | the next and previous section that shows |
| `M-n`, `M-p` | the next and previous sibling |
| `^` | the parent section |
| `1` to `4` | show the sections around point to that level, hiding those below |
| `M-1` to `M-4` | show all sections to that level |

The section at point, or the sibling sections the region selects, are highlighted in `magit-section-highlight`, and headings are drawn in `magit-section-heading`, with the number of children after them. A section made again by a refresh keeps its visibility, found by its identity (its type and value and its ancestors'), and with `magit-section-cache-visibility` so does one that disappears and comes back. `magit-section-initial-visibility-alist` says which kinds of section start hidden, as `[type, "show" | "hide"]` pairs, or `[[type, parent-type...], ...]` for a lineage; `magit-section-set-visibility-hook` can decide too, and `magit-section-movement-hook` runs after each move. `M-x magit-describe-section-briefly` shows the section at point.

For a package building on it, besides `insertRoot`, `insertSection` and `insertHeading` (with a count of children, `true` for one worked out afterwards, or a heading ending in `:`): `magitCancelSection` drops an empty section, `magitInsertSectionBody` inserts a hidden section's body only when it is first shown, `magitGetSection` and `magitSectionIdent` find a section again, `magitSectionMatch`, `magitRegionSections` and `magitRegionValues` say what is at point or selected, and `magitSectionDefineType` gives a type a heading highlight face, a keymap, or a painter that redraws its text when highlighted, as Magit's diff hunks are.

### Writing a mode with it

```ts
import { insertHeading, insertRoot, insertSection, magitSectionMode } from "magit-section";

const fruitMode = e8.defineMajorMode({ name: "fruit-mode", modeName: "Fruit", parent: magitSectionMode, doc: "Fruit, in sections." });

e8.defineCommand({
  name: "list-fruit",
  doc: "List fruit by colour.",
  run: () => {
    e8.call("switch-to-buffer", "*fruit*");
    e8.call(fruitMode);
    e8.letBind({ "inhibit-read-only": true }, () =>
      insertRoot("fruit", () => {
        insertSection("colour", "red", false, () => {
          insertHeading("Red");
          e8.insert("  apple\n  cherry\n");
        });
        insertSection("colour", "yellow", true, () => {
          insertHeading("Yellow");
          e8.insert("  banana\n");
        });
      }),
    );
  },
});
```

`insertRoot` starts the buffer's sections afresh, keeping each section's visibility from the last time by its type and value, as Magit does when it refreshes a buffer. `insertSection(type, value, hidden, body)` inserts a section whose heading and content `body` inserts, and `insertHeading` its heading line. `sections()`, `currentSection()`, `sectionAt(pos)`, `show`, `hide`, `visibleP` and `gotoSection` give and change the sections from code.

## Differences from magit-section.el

- `1` to `4` show every section to that level, as Magit's `M-1` to `M-4` do; there are no `M-1` to `M-4`, nor Magit's `1` to `4` that change only the section at point and its children.
- There are no visibility indicators in the fringe or margin, no clicking on a heading to toggle it, and no `C-c TAB` or `M-<tab>`.
- Sections are plain objects, not EIEIO classes, and there is no `magit-insert-section` macro: `insertSection` takes the section's type, value and whether it starts hidden, and a function that inserts its content.
- `magit-section-initial-visibility-alist` holds `[type, "show" | "hide"]` pairs, matched by the section's type alone: not lineages, wildcards or functions.
- There is no washing of a program's output into sections, no section-specific keymaps, and none of the commands that show or hide a section's children or headings only.

## Credit

This is a port to E8 of [magit-section](https://github.com/magit/magit) 4.4.0, from the Magit repository, by Jonas Bernoulli and the [Magit contributors](https://github.com/magit/magit/blob/main/docs/AUTHORS.md), copyright The Magit Project Contributors, and distributed in NonGNU ELPA and MELPA, under the GNU General Public License version 3 or later. It is not the upstream authors' work as published, and they do not endorse it: report problems with the port here, not upstream.

## Developing

With an E8 on your PATH (a [release](https://github.com/e8-editor/e8/releases), or built from source) and TypeScript 5.8 or newer:

```bash
make test
make types
```

The tests in `test/magit-section-tests.ts` insert sections into a buffer of a test mode built on `magit-section-mode`, and check the tree they make, what shows after `TAB`, `C-<tab>`, `<backtab>` and `1` to `4`, where `n`, `p`, `M-n`, `M-p` and `^` move to, the visibility kept when the buffer is made again, and the highlight.

## Licence

GPL-3.0-or-later: see `LICENSE`.
