// Pure geometry for the classic 11×11 Monopoly square ring (frontend only).
// viewBox 0..1000. Corners are larger squares; the 9 edge cells are rectangles.
// Index→position mapping (clockwise, Go at bottom-right) per the Phase-6 spec.

export const VB = 1000;
export const CORNER = 130;                  // corner square size
export const EDGE = (VB - 2 * CORNER) / 9;  // edge-cell long side
export const BAR = 24;                       // colour-bar thickness

/** Returns { x, y, w, h, edge, rot, cx, cy } for a board index 0-39. */
export function spaceRect(index) {
  let r;
  if (index === 0) r = { x: VB - CORNER, y: VB - CORNER, w: CORNER, h: CORNER, edge: 'corner', rot: 0 };
  else if (index >= 1 && index <= 9) r = { x: CORNER + (9 - index) * EDGE, y: VB - CORNER, w: EDGE, h: CORNER, edge: 'bottom', rot: 0 };
  else if (index === 10) r = { x: 0, y: VB - CORNER, w: CORNER, h: CORNER, edge: 'corner', rot: 0 };
  else if (index >= 11 && index <= 19) r = { x: 0, y: (VB - CORNER) - (index - 11 + 1) * EDGE, w: CORNER, h: EDGE, edge: 'left', rot: 90 };
  else if (index === 20) r = { x: 0, y: 0, w: CORNER, h: CORNER, edge: 'corner', rot: 0 };
  else if (index >= 21 && index <= 29) r = { x: CORNER + (index - 21) * EDGE, y: 0, w: EDGE, h: CORNER, edge: 'top', rot: 180 };
  else if (index === 30) r = { x: VB - CORNER, y: 0, w: CORNER, h: CORNER, edge: 'corner', rot: 0 };
  else r = { x: VB - CORNER, y: CORNER + (index - 31) * EDGE, w: CORNER, h: EDGE, edge: 'right', rot: 270 };
  r.cx = r.x + r.w / 2;
  r.cy = r.y + r.h / 2;
  return r;
}

/** The colour-bar rect along the INNER edge of a space (toward the board centre). */
export function colorBarRect(r) {
  switch (r.edge) {
    case 'bottom': return { x: r.x, y: r.y, w: r.w, h: BAR };           // bar on top (inner)
    case 'left': return { x: r.x + r.w - BAR, y: r.y, w: BAR, h: r.h }; // bar on right (inner)
    case 'top': return { x: r.x, y: r.y + r.h - BAR, w: r.w, h: BAR };  // bar on bottom (inner)
    case 'right': return { x: r.x, y: r.y, w: BAR, h: r.h };            // bar on left (inner)
    default: return null;
  }
}

// Distinct token colours by seat order.
export const TOKEN_COLORS = ['#e2433b', '#2b7fd6', '#2fd07a', '#f5b914', '#e85aa8', '#8b5cf6', '#00d4ff', '#e8893a'];

// Small cluster offsets so multiple tokens on one space don't fully overlap.
export const CLUSTER = [
  [0, 0], [-16, -16], [16, -16], [-16, 16], [16, 16], [0, -22], [0, 22], [-22, 0], [22, 0], [0, 0],
];
