/**
 * Shared normalization for the Sessions-screen search (plain CommonJS +
 * session-search.d.ts so both the app and the mocha tests can load it,
 * same pattern as catalog-search.js / map-markers.js).
 *
 * Matching is comparison-only — displayed text is never normalized here.
 *
 * normalizeSearchValue lowercases and strips every non-alphanumeric
 * character (spaces, hyphens, underscores, slashes, punctuation), so
 * "stat240", "stat 240", "STAT-240" all become "stat240", and cross-listed
 * codes like "ENTOM/ENVIR ST 201" match "entom-envir st 201",
 * "entom envir st 201", or "entomenvirst201" without the exact formatting.
 */
function normalizeSearchValue(value) {
  return value == null
    ? ''
    : String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

/**
 * True when the normalized query occurs in the normalized haystack built
 * from the given fields. Fields are concatenated before matching — the
 * pre-normalization behavior joined fields with spaces and did a substring
 * check, so queries that spanned a boundary (e.g. "stat 240 study" across
 * classId + title) keep matching.
 */
function matchesSessionSearch(fields, query) {
  const normalizedQuery = normalizeSearchValue(query);

  if (!normalizedQuery) {
    return true;
  }

  const fieldList = Array.isArray(fields) ? fields : [fields];
  const haystack = fieldList.map(normalizeSearchValue).join('');

  return haystack.includes(normalizedQuery);
}

module.exports = {
  matchesSessionSearch,
  normalizeSearchValue,
};
