export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type CampusMarkerEntry<Location extends { locationId: string }> = {
  canonicalId: string;
  location: Location;
};

export declare function isRenderableCoordinate(
  coordinate: unknown
): coordinate is MapCoordinate;

export declare function buildCampusMarkerEntries<Location extends { locationId: string }>(
  locations: readonly Location[] | null | undefined,
  options?: { canonicalize?: (locationId: string) => string }
): CampusMarkerEntry<Location>[];
