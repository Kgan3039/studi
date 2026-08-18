'use strict';

function getKeyboardScrollOffset({ targetY, targetHeight, viewportHeight, gap = 0 }) {
  if (
    !Number.isFinite(targetY) ||
    !Number.isFinite(targetHeight) ||
    !Number.isFinite(viewportHeight) ||
    !Number.isFinite(gap) ||
    targetY < 0 ||
    targetHeight < 0 ||
    viewportHeight <= 0 ||
    gap < 0
  ) {
    return 0;
  }

  return Math.max(0, targetY + targetHeight - viewportHeight + gap);
}

module.exports = { getKeyboardScrollOffset };
