# Project D: to do

Ideas agreed but not built, in the order planned. Move an item to HISTORY.md and DECISIONS.md when it ships.

## Rakshith's list (2026-10-17, session 3): one at a time, each started only when he says

1. ✅ (built, PR #6) **Layout view doesn't show the part.** The slots on the sheet are empty rectangles, and the part is still drawn
   at its own position off the sheet (top right). Each slot should show the part itself.
2. ✅ (built, PR #9) **No way to move the part** around on the layout.
3. ✅ (built, PR #6) **Dimensions fix**: a kept dimension reads `300.0002018326812`; round it, with a setting for the number of decimal
   places (0, 1, 2, 3 …).
4. ✅ (built, PR #6) **Many parts, layout on its own page**: several parts from one drawing and from several drawings. Layout moves out
   of each file's Part | Layout switch and becomes its own page, where he picks which parts to use.
5. ✅ (built, PR #6) **Name parts** when he extracts them from a drawing.
6. ✅ (built, PR #6) **Scaling per drawing** (his pick, 2026-10-17): make the drawing 1:1 once (W × H or Set length), then every part
   extracted from it is true size. No per-part scaling.
7. ✅ (built, PR #6) **Grid fit as an option**: today rows and columns are worked out from the sheet size; make that a switch.
8. ✅ (built, PR #6) **Rows and columns by hand**: type the count of rows and columns.
9. ✅ (built, PR #9) **Rotate a part**, CorelDRAW style: on screen, with a pivot point he sets on the part, or by typing an angle.
10. ✅ (built, PR #9) **Custom grids by hand**: on the layout sheet, duplicate a part and place the copy wherever he wants.
11. ✅ (built, PR #9) **Duplicate along X / Y**: pick the direction, the distance between copies and the number of copies.
12. ✅ (built, PR #9) **Mirror** a part in X or Y.
13. ✅ (built, PR #9) **Nudge with the arrow keys**: the step (mm) is set in the top toolbar.
14. ✅ (built, PR #6) **Dimensions AutoCAD style**: click 1 = first point, the callout follows the mouse; click 2 = second point; then the
    callout moves with the mouse (up / down, its offset); click 3 fixes it at that height.
15. ✅ (built, PR #6) **Shift = straight along X or Y** when picking points (Measure, dimensions, Set length, moving parts): the second
    point locks to the horizontal or vertical through the first, whichever is closer to the cursor.
16. ✅ (built, PR #9) **Ctrl while dragging a part = copy** (the original stays, a copy drops where released); **Ctrl + Shift = copy
    and keep it straight** along X or Y, as in 15.
17. ✅ (built, PR #10) **Text**: add text, and resize it.
18. ✅ (built, PR #6) **Dimension callouts**: move and resize them after they're placed.
19. ✅ (built, PR #6) **Save extracted parts** so they can be used again later (his pick, 2026-10-17): saved inside the app by default
    (a Parts library panel to pick from, each part with a preview thumbnail, its name and W × H); **Export** writes a
    part to a .dxf when he asks.
20. ✅ (built, PR #6) **A saved layout reopens with its settings**: sheet, grippers, gaps, extra gaps, rotate, align, marks and the parts
    used, kept inside the .dxf (hidden from other CAD apps), so opening it brings the Layout panel back as it was. Goes
    with 4.

AutoCAD-style additions (his picks, 2026-10-17):

21. ✅ (built, PR #12) **Polar tracking and object-snap tracking**: dotted guides at 15°, 30°, 45° … and lining up with points already in
    the drawing.
22. ✅ (built, PR #10) **Grips**: select something, drag its blue end or middle points to stretch or move it.
23. ✅ (built, PR #10) **Resize the sheet on a layout**: the sheet can be selected and a side dragged to make it bigger or smaller.
24. ✅ (built, PR #10) **Properties panel** for what is selected: layer, colour, line type, length, radius.
25. ✅ (built, PR #10) **Select similar** (same layer or colour) and **Match properties**.
26. ✅ (built, PR #12) **More dimension types**: radius, Ø, angle, and linear (horizontal / vertical).
27. ✅ (built, PR #12) **Dimension styles**: arrow size, text height, decimals and units, saved as presets.
28. ✅ (built, PR #12) **Leaders**: a note with an arrow pointing at something.
29. ✅ (built, PR #12; manual only) **Inspection ballooning**: numbered balloons on a drawing's dimensions and notes, with a list (balloon no. →
    dimension → tolerance); a drawing can have several sheets. Now: placed by hand, on vector PDFs and on PDFs or
    pictures that are only images. Later: automatic (vector PDFs: find the dimension texts; image-only: OCR).
30. ✅ (built, PR #9) **Undo history list**: jump back several steps at once.
31. ✅ (built, PR #8; in the selection bar) **Area and perimeter** of a closed shape (for ink and cost).
32. ✅ (built, PR #9) **Autosave and recovery** after a crash.
33. ✅ (built, PR #8; DXFs and layouts, in the app) **Recent files** on the File menu.
34. ✅ (built, session 10, R12 option 2) **Own keyboard shortcuts**: Tools → Shortcuts…, typed aliases and keys, clash swaps, per-PC storage and .pgp import / export.
35. ✅ (built, PR #9) **Contour**, CorelDRAW style: pick an outline, inside or outside, a distance and a number of steps; corners sharp
    or rounded (his choice per use).

CorelDRAW-style additions (his picks, 2026-10-17):

36. ✅ (built, PR #9) **Align and Distribute**: line up left edges, centres or tops; space parts evenly.
37. ✅ (built, PR #9) **Group / Ungroup and Lock**: move several parts as one; lock things so they can't be bumped.
38. ✅ (built, PR #9) **Rulers and guidelines**: drag guides out of the rulers and snap to them.
39. ✅ (built, session 8, Option A of mock-up R11) **Object Manager**: a tree of everything in the file, layer by layer, with show, hide and lock.
40. **Trace a bitmap** (CorelDRAW's PowerTRACE): a photo or scan of artwork → vector outlines.
41. ✅ (built, PR #10) **Compare parts by colour**: give each part's outline its own colour (e.g. one red, one blue) and lay them over each
    other to see where they differ, e.g. two revisions of the same part. A button lines them up (same corner, or
    centres, using Align from 36), and an option highlights where the outlines differ by more than a set tolerance
    (e.g. 0.1 mm).

From the exe review (2026-10-17, session 3):

42. ✅ (built, PR #8) **Ctrl+0 = Fit** the drawing or sheet to the window.
43. ✅ (built, PR #8, without the click) **"Saved to <folder>"**: after a save, the command line names the folder (and a click opens it).
44. ✅ (built, PR #8, in the status bar) **Active tool chip**: a small label by the cursor or in the status bar saying which tool is on.
45. ✅ (built, PR #9) **New parts snap to the grid** when added to a sheet, with a hint that Shift places them straight.
46. ✅ (built, PR #9) **Fix tiny gaps** in a vector file (his ask, 2026-10-17): find ends that almost meet (within a tolerance he sets,
    e.g. 0.05 mm), mark them on the drawing, and a button joins them (moves the ends together) so outlines close
    properly for area, offset / contour and cutting. Today Area closes a loop across a tiny gap and says so.
47. ✅ (built, session 8, Option B of mock-up R12b: the floating command bar; see DECISIONS) **Full command line, AutoCAD style** (his ask, 2026-10-18; after the two Round 5 builds): every tool and action can be
    typed by name or alias (draw, edit, layout, view, file); Enter or Space repeats the last command; ↑ / ↓ go through
    the command history; autocomplete suggestions as you type; options in [brackets] that can be clicked or typed by
    their capital letter; typed coordinates (absolute, `@x,y`, `@len<angle`); Esc cancels; F2 opens the full command
    history. Mock-up first. TODO 34 (own aliases) builds on it.
48. ✅ (built, session 11, R14 option A) **Line width, CorelDRAW style** (his ask, 2026-10-19): an outline-width picker for the selected objects (preset
    widths plus a typed value, in the drawing's units), shown on screen at true width and kept on Save (DXF lineweight /
    polyline width) and in PDF / Print. Mock-up first. Note: the second-pass review found Mirror / Offset / Trim drop a
    polyline's width; that fix lands first.

From the AutoCAD / CorelDRAW pain-point research (his ask, 2026-10-19: "add all"; S/M/L = size; mock-up first where UI is new):
49. ✅ (built, session 11, R14 option A) **Remove duplicate / overlapping lines** (S–M): stops double cuts and double ink. Builds on Fix tiny gaps (46): report the count, then remove.
50. ✅ (built, session 11, R14 option A) **Preflight check before PDF / film / DXF** (M): one list of duplicates, open paths on a cut layer, tiny gaps, parts off
    the sheet, lines wider than a hairline, text not outlined; each row selects the offenders.
51. ✅ (built, session 11, R14 option A) **One-click unit fix, ×25.4 / ÷25.4** (S), next to Set length: the commonest "my file is the wrong size" cause.
52. ✅ (built, session 11, R14 option B) **Cutter-safe DXF save** (S–M): lines, arcs and polylines only, curves flattened to a typed tolerance. First check what dxf-write.js writes today.
53. **Text to outlines** (L): removes font problems for film and cut files (needs font outlines without a build step).
54. **Wireframe (outline-only) view** (S): one toggle that shows objects stacked or hidden behind fills.
55. **Big-file performance** (M): open a 100k-entity DXF, measure pan / zoom, add culling or an index if it lags.
56. **Font note on open** (S): name the fonts the file asked for and what is shown instead (check first whether one exists).

From the v0.1.30 exe test (Pip-test, 2026-10-20):
57. ✅ (fixed, session 9: the tab strip shrinks and scrolls on its own; tabs and + New layout stay on one line) **Many tabs push the whole window sideways** (bug, S): at 1024 px with ~17 tabs, clicking the last tab shifts the menu bar ~470 px left and cuts off the toolbar; it stays shifted after widening (−169 px at 1440); at 1440 with 14 tabs "+ New layout" wraps. The tab strip should scroll on its own. Screenshots: shots/exe/91-last-tab-1024.png, 66-light1024-layout.png.
58. ✅ (fixed, session 9: the second click's `detail === 2` does it, in `objClick`) **Double-click a layer row in the Objects tab does not make it current** (bug, S): the first click rebuilds the rows, so no dblclick arrives. The Layers panel click works.
59. ✅ (fixed, session 9: counts come from the file's entities, an IMAGE that draws nothing counts; see DECISIONS) **Layer counts disagree** (bug, S): sample.dxf: Layers panel NOTES 6, Objects tab NOTES 7 and 20 in total, status bar 19 entities. Find which count is right.
60. ✅ (tested, session 9, v0.1.30: Save, Save As, PDF / Print and the close prompt all pass; Pip-test drives the dialogs with shots/exe/uia.ps1) **Exe test of the native dialogs** (test, S): Save, Save As, PDF / Print save, the close prompt (Save / Don't save / Cancel; after Don't save a restart offers no recovery). Pip-test drives the Windows dialogs itself with UI Automation (PowerShell, by window title); a key press only after it has checked Project D is the foreground window (his call: he leaves the PC alone during the test). Not reached in the v0.1.30 test: the boxes piled up and he cancelled them by hand.
61. ✅ (fixed, session 9: `flatten` now registers every top-level entity's layer after the walk, so a cut-off file keeps all its layers; test in doc.test.mjs) **Counts on files past the draw limit** (bug, S): when a file hits the 400,000-piece draw limit, `flatten` stops before later layers reach `fl.layers`, so `layerCounts` skips their entities while `entityCount` and the Objects tree still count them (and that tree layer's eye / lock get idx -1). Fix: register every top-level entity's layer before the cut (or build the list from `raw.layers` too), plus a test with a cut-off file. From the Pip-review of 58 / 59.
62. ✅ (fixed, session 9: the new tab's dirty setter clears `empty` on any edit or save; browser coverage keeps drawn, edited and saved tabs and still replaces untouched ones) **Opening a file replaces a saved drawn tab** (bug, S): `+`, draw a line, Save it, then Open another file: the drawn tab disappears (the file stays on disk). `web/app.js:521` replaces an "untouched empty tab" and the `empty` flag (`web/app.js:178`) is never cleared by drawing. From the TODO 60 exe test.
63. ✅ (fixed, session 10: Save As reuses first Save's suggestion in the opened file's folder, as "<name>-edited.dxf"; new drawings keep the last-used folder) **Save As starts in the last-used folder** (question, S): from the TODO 60 exe test; decided 2026-10-20 (see DECISIONS).
64. ✅ (fixed, session 9: importing a background into a drawing marks it dirty and clears `empty`; browser coverage keeps the fresh tab and its picture on Open) **Import background on a fresh tab is lost on Open** (bug, S): new tab, pick a tool without drawing, Import background, then Open a file: the tab is replaced and the picture lost. `web/app.js:3447`: set `d.dirty = true` in that `else` branch. From the Pip-review of 62 (older than 62).
65. **Contour: colour and line style** (his ask, 2026-10-20, S–M): the Contour panel picks the new outlines' colour and line style (solid, dashed, dotted). Today they always go on the layer "Contour" with its colour, solid. Saved to DXF as the entity's colour and linetype.

65. ✅ (built, session 10) **Contour colour and line style**: R13 swatches and Solid / Dashed / Dotted, both previews, Properties, DXF round trip and PDF; one-step undo.

From the UI research (Pip, 2026-10-20, ranked; page https://claude.ai/artifact/VPxPFSo6u1vonP7QdBetXE; his ask: all of it):
66. **More Modify tools** (S–L): Move and Copy (base point, then target or typed distance) first, then Rotate and Scale, then Fillet and Extend; in the Modify menu and the command bar (AutoCAD M, CO, RO, SC, F, EX).
67. **Guide lines when placing parts** (M): dragging a part on a layout snaps its edges and centre to other parts and the sheet, with a thin line and the gap in mm (CorelDRAW Dynamic Guides, Illustrator Smart Guides).
68. **Snap per type** (M): a popover on the SNAP chip with a tick box per type; add intersection and quadrant (perpendicular, tangent later); the type's name beside the marker (AutoCAD Object Snap).
69. **Live numbers at the cursor** (M): a tag by the cursor with length, angle, Δx, Δy; typing fills the first field, Tab the next (AutoCAD Dynamic Input, F12).
70. **Relative and polar typed input** (S): `@dx,dy` and `len<angle` in every point prompt; Enter on an empty command bar repeats the last command (check first what already works).
71. **Selection feedback** (S–M): left-to-right box = window (solid blue, fully inside), right-to-left = crossing (dashed green, touching); Alt + click cycles overlapping objects (doubled DXF lines). Check first what exists.
72. **Right-click while drawing** (S): during a tool, right-click finishes (Enter); a menu with Cancel, Close, Undo last point and the snap list.
73. **Tooltips and F-keys** (S): tooltip = name + alias + key; add F3 snap, F8 ortho, F9 grid; optional "show labels" on the rail.
74. **More zooms** (S): Zoom Window, Zoom Selection, Zoom Previous (Z W, Z S, Z P).
75. **Array on a drawing** (M): rows / columns / spacing, plus polar (holes in a ring); step and repeat today is layouts only.
76. **Dimensions drive the drawing** (L, later): double-click a dimension, type a value, the line stretches; no full constraints.

From the CAD forums research (Pip, 2026-10-20; page https://claude.ai/artifact/Sp3eoq15FKgsVFQpxmpPd7; his picks):
77. **Layer search box** (S): a small search box above the Layers list and the Objects tree; matches show, the rest hide (QCAD forum, 7 Oct 2026).
78. **Trim preview** (M): while the pointer is over a segment in Trim, draw the part that would go in faint red; the preview must match the result (LibreCAD #2632, #2647).

## Next sessions (2D, for screen-printing layouts; screen A is built)

1. ✅ (built, PR #10) Drawing tools: line, polyline, rectangle, rounded rectangle, circle, ellipse, arc, text and dimension, with snaps, ortho and polar tracking, and typed coordinates. (Text: TODO 17. Polar tracking: TODO 21, built in PR #12.)
2. Edit tools: offset, trim, mirror, move, copy, rotate, scale, and undo and redo.
3. ✅ (built, session 6, option B of mock-up R10) Auto-nest of mixed parts.
4. Place by hand.
5. Import parts from DXF, DWG, CorelDRAW and PDF (mock-up "Import parts").
6. **Before starting: switch the repo back to private and bring back the CI diet (DECISIONS 2026-10-19).** DWG open through LibreDWG, in its own module.
7. .cdr open through libcdr. For now (his call, 2026-10-17): CorelDRAW → Export PDF, then open the PDF. He'll send a few .cdr files with their exported PDFs after PR #5; test libcdr on them first, and if it can't read them, write our own .cdr reader for what his files use (outlines, curves, text), checked against the PDFs.
8. Layers panel editing.
9. Title block with the revision table.
10. The 3D viewer ported from Project R (mock-up "3D viewer").

## Later (scope §5)

1. Sketcher with constraints, solved by PlaneGCS.
2. 3D parts on OpenCascade: extrude, revolve, cut, hole, fillet and chamfer, with a feature history.
3. Drawings from the model, saved as DXF and PDF.
4. Assemblies, sheet metal and a bill of materials.

## Small things noticed

1. IBM Plex fonts are not bundled, so the system font is used. Bundle them locally if he wants the mock-up's look.
2. A per-user .dxf file association, with no admin rights.
3. A "keep settings next to the exe" switch.
