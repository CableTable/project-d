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
34. **Own keyboard shortcuts**, like AutoCAD's PGP aliases.
35. ✅ (built, PR #9) **Contour**, CorelDRAW style: pick an outline, inside or outside, a distance and a number of steps; corners sharp
    or rounded (his choice per use).

CorelDRAW-style additions (his picks, 2026-10-17):

36. ✅ (built, PR #9) **Align and Distribute**: line up left edges, centres or tops; space parts evenly.
37. ✅ (built, PR #9) **Group / Ungroup and Lock**: move several parts as one; lock things so they can't be bumped.
38. ✅ (built, PR #9) **Rulers and guidelines**: drag guides out of the rulers and snap to them.
39. **Object Manager**: a tree of everything in the file, layer by layer, with show, hide and lock.
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
47. **Full command line, AutoCAD style** (his ask, 2026-10-18; after the two Round 5 builds): every tool and action can be
    typed by name or alias (draw, edit, layout, view, file); Enter or Space repeats the last command; ↑ / ↓ go through
    the command history; autocomplete suggestions as you type; options in [brackets] that can be clicked or typed by
    their capital letter; typed coordinates (absolute, `@x,y`, `@len<angle`); Esc cancels; F2 opens the full command
    history. Mock-up first. TODO 34 (own aliases) builds on it.

## Next sessions (2D, for screen-printing layouts; screen A is built)

1. ✅ (built, PR #10) Drawing tools: line, polyline, rectangle, rounded rectangle, circle, ellipse, arc, text and dimension, with snaps, ortho and polar tracking, and typed coordinates. (Text: TODO 17. Polar tracking: TODO 21, built in PR #12.)
2. Edit tools: offset, trim, mirror, move, copy, rotate, scale, and undo and redo.
3. Auto-nest of mixed parts.
4. Place by hand.
5. Import parts from DXF, DWG, CorelDRAW and PDF (mock-up "Import parts").
6. DWG open through LibreDWG, in its own module.
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
