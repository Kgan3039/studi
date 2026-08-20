async function createBlockIdempotently({ writeBlock, readBlock, blockerUserId, blockedUserId }) {
  try {
    await writeBlock();
    return;
  } catch (writeError) {
    try {
      const existing = await readBlock();
      if (
        existing &&
        existing.blockerUserId === blockerUserId &&
        existing.blockedUserId === blockedUserId
      ) {
        return;
      }
    } catch {
      // Preserve the original write failure; the verification read is only a
      // response-loss recovery path.
    }
    throw writeError;
  }
}

module.exports = { createBlockIdempotently };
