export function dedupeMessageRows<T extends { type: "dm" | "group"; id: string }>(
  rows: T[]
): T[];
export function areMessageSourcesLoaded(sources: {
  dm: boolean;
  group: boolean;
  hidden: boolean;
}): boolean;
export function isMessageRowVisible(options?: {
  type?: "dm" | "group";
  isHidden?: boolean;
  isPendingRemoval?: boolean;
}): boolean;
