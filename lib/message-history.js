"use strict";

function dedupeMessageRows(rows) {
  const byKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || (row.type !== "dm" && row.type !== "group") || typeof row.id !== "string") {
      continue;
    }
    const key = `${row.type}:${row.id}`;
    if (!byKey.has(key)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

function areMessageSourcesLoaded(sources) {
  return Boolean(sources && sources.dm && sources.group && sources.hidden);
}

function isMessageRowVisible({ type, isHidden, isPendingRemoval } = {}) {
  if (type === "dm") {
    return true;
  }
  return type === "group" && !isHidden && !isPendingRemoval;
}

module.exports = {
  areMessageSourcesLoaded,
  dedupeMessageRows,
  isMessageRowVisible,
};
