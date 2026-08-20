type BlockRecord = { blockedUserId?: unknown; blockerUserId?: unknown } | null;

export function createBlockIdempotently(options: {
  blockedUserId: string;
  blockerUserId: string;
  readBlock: () => Promise<BlockRecord>;
  writeBlock: () => Promise<void>;
}): Promise<void>;
