/** Local coordinates of the viewport origin: subtract before Canvas converts path coordinates to floats. */
export function viewOrigin(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return det ? [(m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det] : [0, 0];
}
