# .table app icon (in progress)

An impossible `#`: two rows and two columns woven in one flat layer, each bar over at one crossing and under at the next. It follows "Impossible grid" (Unmoegliches_Objekt_2.svg on Wikimedia Commons), drawn face-on with depth as a diagonal offset down and to the left, in the Workspace glyph's line style.

## Status (3 Oct 2026)

- Leslie chose **Squattest** (`candidates/1-squattest.svg`) and asked for revisions of it.
- Five revisions are in `candidates/2` to `6`, and `sheets/squattest-revisions.png` shows each at full size, 60 pt and 29 pt. **Leslie hasn't picked one yet.**
- Next: once Leslie picks, add it to `apps/mobile` (app.json `icon` / `ios.icon`, assets in `apps/mobile/assets/images/`). Then Primary prebuilds and installs a test build on Leslie's iPhone (Waypoint).

## Style

- Same as `workspace-glyph.svg` in the workspace repo: a 623 canvas, glyph 474 wide, lines 8.1 wide (except revision 6, which uses 11).
- It isn't stroked. It's one black silhouette with each visible face cut out (evenodd), so lines are even and corners are sharp with no join spikes.

## Tools (Python 3.12, `shapely`)

- `tools/oblique.py`: `hash_t1(w, gap, over, depth, flip)` draws the #. The crossings come from `weave_regions`: whole bars are drawn, then at each crossing the bar on top is drawn again, clipped to a window around that crossing.
- `tools/grids.py`: `plane_grid` and `weave`. `tools/impossible.py`: the projection helpers.
- `tools/search.py`: `slivers()` scores thin strips of side face. Keep it at 0.
  - Proportions where it is 0: the ends stick out 1.2 × the bar width with depth 1.2 × the width (Squattest: w 1.8, gap 2.2, over 2.16, depth 2.16), or the ends and the depth offset are each one bar width.
  - Shorter ends or shallower bars than that leave slits.
- `tools/rev.py` and `tools/rev2.py` regenerate the revisions.
- Render previews with `qlmanage -t -s 600 -o . file.svg`, since ImageMagick renders these blank.

## Lessons

- Redraw the reference itself, in its own projection and proportions. Re-projecting the face-on # into isometric made it unreadable.
- Look at every drawing large, and at 60 pt and 29 pt next to the Workspace glyph, before showing it.

## Perspective (3 Oct, after #341)

Leslie noticed the shipped bars look oblong next to the Workspace glyph's square ones. Cause: Workspace is isometric, so each bar shows two long faces of equal width; the # is face-on with a diagonal depth offset, and its side face is only 0.6 of the front.

- `sheets/perspective-compare.png`: Workspace, A (shipped, 0.6), B (0.8), C (1.0), each at full size, 60 pt and 29 pt.
- B: `regs(1.8, 3.0, 2.34, 2.88)`; C: `regs(1.5, 3.0, 1.5, 3.0)` in `tools/persp.py` (weave reversed, as shipped). Both score 0 slivers. `tools/find.py` searches other sliver-free proportions per ratio.
- C crowds the cells and shortens the ends. A true isometric # has square bars but tilts the # onto a slanted floor, which Leslie rejected; a clean retry read as a pile of blocks.
- Leslie hasn't chosen between A, B and C. Linux owns the icon and the decision's follow-through.
