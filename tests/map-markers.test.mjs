import assert from "node:assert/strict";

import mapMarkers from "../lib/map-markers.js";

const { buildCampusMarkerEntries, isRenderableCoordinate } = mapMarkers;

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
