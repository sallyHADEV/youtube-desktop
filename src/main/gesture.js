'use strict';

/**
 * Mouse-gesture navigation: hold the right button and drag.
 *
 *   ←   back        →   forward        ↓ then →   close the window
 *
 * The preload only records the path; the meaning is decided here, so it can be
 * tested without a renderer and the thresholds have exactly one definition (the
 * preload receives them as launch arguments).
 */

/** Minimum travel, in CSS pixels, before a drag counts as a gesture at all. */
const THRESHOLD_PX = 60;

/**
 * A path segment must be at least this long to register as a stroke. Small
 * enough to catch a deliberate corner, large enough that a wobbly straight line
 * does not turn into a staircase of alternating strokes.
 */
const STROKE_MIN_PX = 45;

/** Recognised stroke sequences. `D` down, `R` right, `L` left, `U` up. */
const GESTURES = new Map([
  ['L', 'back'],
  ['R', 'forward'],
  ['DR', 'close'],
]);

/**
 * Reduce a path to the sequence of directions it actually travelled, collapsing
 * consecutive strokes that head the same way.
 *
 * @param {{x: number, y: number}[]} path
 * @returns {string} e.g. `"DR"` for an L-shape drawn downwards then right.
 */
function toStrokes(path, minSegment = STROKE_MIN_PX) {
  if (!Array.isArray(path) || path.length < 2) return '';

  const strokes = [];
  let anchor = path[0];
  if (!isPoint(anchor)) return '';

  for (const point of path.slice(1)) {
    if (!isPoint(point)) continue;
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    if (Math.hypot(dx, dy) < minSegment) continue;

    // Snap to the dominant axis: gestures are drawn by hand, never square.
    const direction =
      Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'L' : 'R') : (dy < 0 ? 'U' : 'D');
    if (strokes.at(-1) !== direction) strokes.push(direction);
    anchor = point;
  }
  return strokes.join('');
}

function isPoint(value) {
  return Number.isFinite(value?.x) && Number.isFinite(value?.y);
}

/**
 * @param {{ dx: unknown, dy: unknown, path?: unknown }} drag
 * @param {{ threshold?: number, minSegment?: number }} [options]
 * @returns {'back'|'forward'|'close'|null} null when the drag meant nothing.
 */
function resolveGesture(drag, options = {}) {
  const { threshold = THRESHOLD_PX, minSegment = STROKE_MIN_PX } = options;
  const dx = Number(drag?.dx);
  const dy = Number(drag?.dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;

  // Shapes with a corner are only recognisable from the path.
  const strokes = toStrokes(drag?.path, minSegment);
  if (strokes.length > 1) return GESTURES.get(strokes) ?? null;

  // A single stroke is judged on the overall displacement instead: it is the
  // steadier measurement, and a straight drag is the common case by far.
  if (Math.abs(dx) < threshold) return null;
  // Require it to be clearly horizontal, so dragging at an angle (or selecting
  // text diagonally) does not navigate away from the page.
  if (Math.abs(dx) <= Math.abs(dy)) return null;

  return dx < 0 ? 'back' : 'forward';
}

module.exports = { resolveGesture, toStrokes, THRESHOLD_PX, STROKE_MIN_PX, GESTURES };
