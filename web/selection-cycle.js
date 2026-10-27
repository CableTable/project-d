// Selection cycling state uses screen pixels, independent of drawing units or zoom.
export function cyclePick(previous, hits, point, tolerance, revision, selected = []) {
  if (!hits.length) return null;
  const same = previous && previous.revision === revision &&
    Math.hypot(point[0] - previous.point[0], point[1] - previous.point[1]) <= tolerance &&
    hits.length === previous.hits.length && hits.every((hit, i) => hit === previous.hits[i]);
  const index = same ? (previous.index + 1) % hits.length : 0;
  return { hits, point: same ? previous.point : point, revision, index, hit: hits[index], before: same ? previous.before : [...selected],
    drop: same && !previous.before.includes(previous.hit) ? previous.hit : null };
}
