import { orthoLock } from './edit.js';

/** Body drags keep object snaps exact; free movement rounds to 0.01 mm. */
export function dragTarget(from, point, factor, straight) {
  const locked = straight ? orthoLock(from, point) : point;
  const to = point[2] && !locked[2] ? [locked[0], locked[1], point[2]] : locked;
  const delta = (i) => point[2] ? to[i] - from[i] : Math.round((to[i] - from[i]) * factor * 100) / 100 / factor;
  return { to, dx: delta(0), dy: delta(1) };
}
