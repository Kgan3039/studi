export const LOCATION_RATING_TAG_GROUPS = [
  {
    label: 'Atmosphere',
    tags: ['Quiet', 'Loud', 'Crowded', 'Spacious'],
  },
  {
    label: 'Study fit',
    tags: ['Group Friendly', 'Solo Focused', 'Reservable Rooms'],
  },
  {
    label: 'Amenities',
    tags: [
      'Good WiFi',
      'Poor WiFi',
      'Outlets Available',
      'Natural Light',
      'Open Late',
      'Food Nearby',
    ],
  },
  {
    label: 'Comfort',
    tags: ['Comfortable', 'Cold Inside', 'Warm Inside'],
  },
] as const;

export type LocationRatingTag = (typeof LOCATION_RATING_TAG_GROUPS)[number]['tags'][number];

export const LOCATION_RATING_TAGS: LocationRatingTag[] = LOCATION_RATING_TAG_GROUPS.flatMap(
  (group) => [...group.tags]
);

export const LOCATION_ATMOSPHERE_FILTERS = [
  'Quiet',
  'Loud',
  'Crowded',
  'Spacious',
  'Group Friendly',
  'Solo Focused',
] as const satisfies readonly LocationRatingTag[];

export type LocationAtmosphereFilter = (typeof LOCATION_ATMOSPHERE_FILTERS)[number];

export function sanitizeLocationRatingTags(tags: unknown) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return LOCATION_RATING_TAGS.filter((tag) => tags.includes(tag));
}
