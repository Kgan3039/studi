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

export declare function hiddenMarkerCoordinate(canonicalId: string): MapCoordinate;

export type PlannedCampusMarker<Marker> = Marker & {
  isVisible: boolean;
  renderCoordinate: MapCoordinate;
};

export declare function planCampusMarkers<
  Marker extends {
    canonicalId: string;
    coordinate: MapCoordinate;
    location: { locationId: string };
  },
>(
  markers: readonly Marker[] | null | undefined,
  visibleLocationIds: ReadonlySet<string> | readonly string[] | null | undefined
): {
  fitCoordinates: MapCoordinate[];
  markers: PlannedCampusMarker<Marker>[];
};
