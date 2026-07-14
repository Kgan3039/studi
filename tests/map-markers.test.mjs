import assert from "node:assert/strict";

import mapMarkers from "../lib/map-markers.js";

const {
  buildCampusMarkerEntries,
  hiddenMarkerCoordinate,
  isRenderableCoordinate,
  planCampusMarkers,
} = mapMarkers;

const UW_CAMPUS = { latitude: 43.0747, longitude: -89.414 };

function marker(canonicalId, latitude, longitude) {
  return {
    canonicalId,
    coordinate: { latitude, longitude },
    location: { locationId: canonicalId },
  };
}

const CAMPUS_MARKERS = [
  marker("college-library", 43.0766969, -89.4013466),
  marker("memorial-union", 43.076421, -89.3999144),
  marker("union-south", 43.0718561, -89.4080738),
];

// Mirrors lib/catalog.ts alias behavior without importing TypeScript.
const ALIASES = { morgridge: "discovery-building" };
const canonicalize = (locationId) => ALIASES[locationId] ?? locationId;

function location(locationId, extra = {}) {
  return { locationId, name: locationId, ...extra };
}

describe("campus map marker entries", () => {
  it("keys every entry by canonical location id", () => {
    const entries = buildCampusMarkerEntries(
      [location("morgridge"), location("college-library")],
      { canonicalize }
    );

    assert.deepEqual(
      entries.map((entry) => entry.canonicalId),
      ["college-library", "discovery-building"]
    );
    assert.equal(entries[1].location.locationId, "morgridge");
  });

  it("deduplicates by canonical id, keeping the first occurrence", () => {
    const curated = location("discovery-building", { name: "Discovery Building" });
    const alias = location("morgridge", { name: "Morgridge Hall" });
    const entries = buildCampusMarkerEntries([curated, alias, curated], { canonicalize });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].canonicalId, "discovery-building");
    assert.equal(entries[0].location, curated);
  });

  it("never emits duplicate keys even without a canonicalizer", () => {
    const entries = buildCampusMarkerEntries([
      location("college-library"),
      location("college-library"),
    ]);

    assert.equal(entries.length, 1);
  });

  it("emits the same stable order regardless of input order", () => {
    const spots = [location("steenbock"), location("college-library"), location("memorial-union")];
    const forward = buildCampusMarkerEntries(spots);
    const reversed = buildCampusMarkerEntries([...spots].reverse());
    const shuffled = buildCampusMarkerEntries([spots[1], spots[2], spots[0]]);

    const order = forward.map((entry) => entry.canonicalId);

    assert.deepEqual(order, ["college-library", "memorial-union", "steenbock"]);
    assert.deepEqual(reversed.map((entry) => entry.canonicalId), order);
    assert.deepEqual(shuffled.map((entry) => entry.canonicalId), order);
  });

  it("drops entries without a usable location id", () => {
    const entries = buildCampusMarkerEntries(
      [
        null,
        undefined,
        "college-library",
        location(""),
        location("   "),
        { name: "no id at all" },
        location(42),
        location("memorial-union"),
      ],
      { canonicalize }
    );

    assert.deepEqual(
      entries.map((entry) => entry.canonicalId),
      ["memorial-union"]
    );
  });

  it("drops entries whose canonical id is unusable", () => {
    const entries = buildCampusMarkerEntries([location("ghost-spot")], {
      canonicalize: () => "",
    });

    assert.equal(entries.length, 0);
  });

  it("tolerates a missing or non-array location list", () => {
    assert.deepEqual(buildCampusMarkerEntries(null), []);
    assert.deepEqual(buildCampusMarkerEntries(undefined), []);
    assert.deepEqual(buildCampusMarkerEntries("college-library"), []);
  });
});

describe("campus marker render plan", () => {
  it("keeps keys, order, and count identical across visibility changes", () => {
    const allVisible = planCampusMarkers(CAMPUS_MARKERS, [
      "college-library",
      "memorial-union",
      "union-south",
    ]);
    const oneVisible = planCampusMarkers(CAMPUS_MARKERS, ["memorial-union"]);
    const noneVisible = planCampusMarkers(CAMPUS_MARKERS, []);

    const keys = (plan) => plan.markers.map((entry) => entry.canonicalId);

    assert.deepEqual(keys(allVisible), ["college-library", "memorial-union", "union-south"]);
    assert.deepEqual(keys(oneVisible), keys(allVisible));
    assert.deepEqual(keys(noneVisible), keys(allVisible));
  });

  it("renders visible markers at their original coordinates", () => {
    const plan = planCampusMarkers(CAMPUS_MARKERS, ["college-library", "union-south"]);

    for (const entry of plan.markers) {
      if (entry.isVisible) {
        assert.deepEqual(entry.renderCoordinate, entry.coordinate);
      }
    }

    assert.equal(plan.markers.filter((entry) => entry.isVisible).length, 2);
  });

  it("relocates hidden markers to valid deterministic off-campus coordinates", () => {
    const first = planCampusMarkers(CAMPUS_MARKERS, ["memorial-union"]);
    const second = planCampusMarkers(CAMPUS_MARKERS, ["memorial-union"]);

    const hiddenEntries = first.markers.filter((entry) => !entry.isVisible);

    assert.equal(hiddenEntries.length, 2);

    for (const [index, entry] of hiddenEntries.entries()) {
      assert.equal(isRenderableCoordinate(entry.renderCoordinate), true);
      // Far outside the UW region — nowhere near the campus viewport.
      assert.ok(Math.abs(entry.renderCoordinate.latitude - UW_CAMPUS.latitude) > 30);
      assert.ok(Math.abs(entry.renderCoordinate.longitude - UW_CAMPUS.longitude) > 30);
      // Deterministic across renders.
      const again = second.markers.filter((candidate) => !candidate.isVisible)[index];
      assert.deepEqual(entry.renderCoordinate, again.renderCoordinate);
    }

    // Hidden annotations do not stack at one native point.
    assert.notDeepEqual(hiddenEntries[0].renderCoordinate, hiddenEntries[1].renderCoordinate);
  });

  it("excludes hidden markers from camera fitting", () => {
    const plan = planCampusMarkers(CAMPUS_MARKERS, ["memorial-union"]);

    assert.deepEqual(plan.fitCoordinates, [{ latitude: 43.076421, longitude: -89.3999144 }]);

    const empty = planCampusMarkers(CAMPUS_MARKERS, []);

    assert.deepEqual(empty.fitCoordinates, []);
  });

  it("accepts a Set or an array of visible ids and tolerates null", () => {
    const fromSet = planCampusMarkers(CAMPUS_MARKERS, new Set(["union-south"]));
    const fromArray = planCampusMarkers(CAMPUS_MARKERS, ["union-south"]);

    assert.deepEqual(fromSet, fromArray);
    assert.deepEqual(planCampusMarkers(CAMPUS_MARKERS, null).fitCoordinates, []);
    assert.deepEqual(planCampusMarkers(null, ["union-south"]).markers, []);
  });

  it("never emits an invalid hidden coordinate, even for odd ids", () => {
    for (const id of ["", "x", "a-very-long-canonical-location-id-with-dashes", "ÜNÏCODE"]) {
      const coordinate = hiddenMarkerCoordinate(id);

      assert.equal(isRenderableCoordinate(coordinate), true);
    }

    assert.equal(isRenderableCoordinate(hiddenMarkerCoordinate(undefined)), true);
  });
});

describe("renderable coordinates", () => {
  it("accepts finite in-range coordinates", () => {
    assert.equal(isRenderableCoordinate({ latitude: 43.0747, longitude: -89.414 }), true);
    assert.equal(isRenderableCoordinate({ latitude: -90, longitude: 180 }), true);
  });

  it("rejects missing, malformed, or out-of-range coordinates", () => {
    assert.equal(isRenderableCoordinate(undefined), false);
    assert.equal(isRenderableCoordinate(null), false);
    assert.equal(isRenderableCoordinate({}), false);
    assert.equal(isRenderableCoordinate({ latitude: 43.07 }), false);
    assert.equal(isRenderableCoordinate({ latitude: "43.07", longitude: "-89.41" }), false);
    assert.equal(isRenderableCoordinate({ latitude: Number.NaN, longitude: -89.41 }), false);
    assert.equal(isRenderableCoordinate({ latitude: 43.07, longitude: Infinity }), false);
    assert.equal(isRenderableCoordinate({ latitude: 90.1, longitude: -89.41 }), false);
    assert.equal(isRenderableCoordinate({ latitude: 43.07, longitude: -180.5 }), false);
  });
});
