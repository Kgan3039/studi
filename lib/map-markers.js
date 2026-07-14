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

// Hidden markers stay mounted (stable child array) but are relocated to a
// deterministic spot in a remote patch of the South Atlantic, far outside
// the UW region. Even invisible (opacity 0) MapKit annotations participate
// in coordinate-proximity selection, so being physically elsewhere is the
// only hidden state that is guaranteed noninteractive on Apple Maps.
const HIDDEN_MARKER_REGION = { latitude: -47.5, longitude: -38.7 };
const HIDDEN_MARKER_GRID = 32;
const HIDDEN_MARKER_SPACING = 0.001;

/**
 * Deterministic off-screen coordinate for a hidden marker. Derived from the
 * canonical id so it never changes between renders, and spread over a small
 * grid so hidden annotations do not stack at one native point.
 */
function hiddenMarkerCoordinate(canonicalId) {
  const id = typeof canonicalId === "string" ? canonicalId : "";
  let hash = 0;

  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % (HIDDEN_MARKER_GRID * HIDDEN_MARKER_GRID);
  }

  return {
    latitude:
      HIDDEN_MARKER_REGION.latitude +
      Math.floor(hash / HIDDEN_MARKER_GRID) * HIDDEN_MARKER_SPACING,
    longitude:
      HIDDEN_MARKER_REGION.longitude + (hash % HIDDEN_MARKER_GRID) * HIDDEN_MARKER_SPACING,
  };
}

/**
 * Render plan for the native map: every marker keeps its key, order, and
 * child position regardless of visibility. Hidden markers get an off-screen
 * renderCoordinate; only visible markers contribute to camera fitting.
 */
function planCampusMarkers(markers, visibleLocationIds) {
  const visibleIds =
    visibleLocationIds instanceof Set ? visibleLocationIds : new Set(visibleLocationIds ?? []);
  const fitCoordinates = [];

  const planned = (Array.isArray(markers) ? markers : []).map((marker) => {
    const isVisible = visibleIds.has(marker.location.locationId);

    if (isVisible) {
      fitCoordinates.push(marker.coordinate);
    }

    return {
      ...marker,
      isVisible,
      renderCoordinate: isVisible ? marker.coordinate : hiddenMarkerCoordinate(marker.canonicalId),
    };
  });

  return { fitCoordinates, markers: planned };
}

module.exports = {
  buildCampusMarkerEntries,
  hiddenMarkerCoordinate,
  isRenderableCoordinate,
  planCampusMarkers,
};
