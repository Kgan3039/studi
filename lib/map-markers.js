// Pure helpers that make the map's marker set deterministic before it ever
// reaches react-native-maps. AIRMap keeps its children in a mutable native
// array, and under the New Architecture interop any duplicate key, unstable
// key, or render-to-render reordering can push its child indexes out of
// bounds (SIGABRT in `AIRMap insertReactSubview:atIndex:`). Everything the
// map renders must therefore be deduplicated by canonical location id and
// emitted in one stable order.
//
// Plain CommonJS (like functions/*.js) so `npm run test:map` can exercise it
// without a transpile step; components import it through lib/map-markers.d.ts.

function identity(locationId) {
  return locationId;
}

function isRenderableCoordinate(coordinate) {
  if (!coordinate || typeof coordinate !== "object") {
    return false;
  }

  const { latitude, longitude } = coordinate;

  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

/**
 * Normalizes raw study locations into marker entries the map can render
 * directly: one entry per canonical location id (first occurrence wins, so
 * curated records beat later aliases), sorted by canonical id so the child
 * order never depends on upstream fetch/sort order.
 */
function buildCampusMarkerEntries(locations, options) {
  const canonicalize =
    options && typeof options.canonicalize === "function" ? options.canonicalize : identity;
  const entriesById = new Map();

  for (const location of Array.isArray(locations) ? locations : []) {
    if (!location || typeof location !== "object") {
      continue;
    }

    const { locationId } = location;

    if (typeof locationId !== "string" || locationId.trim() === "") {
      continue;
    }

    const canonicalId = canonicalize(locationId);

    if (typeof canonicalId !== "string" || canonicalId.trim() === "") {
      continue;
    }

    if (!entriesById.has(canonicalId)) {
      entriesById.set(canonicalId, { canonicalId, location });
    }
  }

  return [...entriesById.values()].sort((first, second) =>
    first.canonicalId < second.canonicalId ? -1 : first.canonicalId > second.canonicalId ? 1 : 0
  );
}

module.exports = {
  buildCampusMarkerEntries,
  isRenderableCoordinate,
};
