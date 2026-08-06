'use strict';

/**
 * Video rotation geometry.
 *
 * Rotating a video 90° swaps the width and height of the box it occupies, so a
 * landscape video turned on its side sticks out well past the player. The scale
 * factor here shrinks it back to fit.
 *
 * Kept separate from the preload so the arithmetic can be tested directly.
 */

const QUARTER_TURN = 90;
const FULL_TURN = 360;

/** @returns {number} the next angle in the 0 → 90 → 180 → 270 → 0 cycle. */
function nextAngle(current) {
  const angle = Number(current);
  if (!Number.isFinite(angle)) return QUARTER_TURN;
  return (((angle + QUARTER_TURN) % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

/**
 * How much a rotated box must shrink to stay inside its container.
 *
 * At 0° and 180° nothing changes. At 90° and 270° the box is effectively
 * `height × width`, so it has to fit the container both ways round.
 *
 * @param {number} angle degrees
 * @param {{width: number, height: number}} box the element being rotated
 * @param {{width: number, height: number}} container
 */
function fitScale(angle, box, container) {
  if (Number(angle) % 180 === 0) return 1;

  const w = Number(box?.width);
  const h = Number(box?.height);
  const containerWidth = Number(container?.width);
  const containerHeight = Number(container?.height);
  const measurements = [w, h, containerWidth, containerHeight];
  if (measurements.some((value) => !Number.isFinite(value) || value <= 0)) return 1;

  // Never scale up: a video that already fits should not be enlarged.
  return Math.min(containerWidth / h, containerHeight / w, 1);
}

/**
 * The CSS `transform` for a given angle, or an empty string at 0° so the
 * property can be cleared rather than set to a no-op.
 */
function transformFor(angle, box, container) {
  const degrees = Number(angle) % FULL_TURN;
  if (!Number.isFinite(degrees) || degrees === 0) return '';

  const scale = fitScale(degrees, box, container);
  // Three decimals is well under a pixel at any realistic player size.
  return `rotate(${degrees}deg) scale(${Number(scale.toFixed(3))})`;
}

module.exports = { nextAngle, fitScale, transformFor, QUARTER_TURN };
