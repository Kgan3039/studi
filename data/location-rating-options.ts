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

export const LOCATION_ATMOSPHERE_TAG_ALIASES: Record<LocationAtmosphereFilter, readonly string[]> = {
  Quiet: ['quiet'],
  Loud: ['loud'],
  Crowded: ['crowded'],
  Spacious: ['spacious'],
  'Group Friendly': [
    'group friendly',
    'group study',
    'groups',
    'collaborative',
    'collaboration',
    'meetup',
  ],
  'Solo Focused': ['solo focused', 'solo', 'focused'],
};

const LOCATION_ATMOSPHERE_ALIAS_LOOKUP = new Map(
  LOCATION_ATMOSPHERE_FILTERS.flatMap((filter) =>
    LOCATION_ATMOSPHERE_TAG_ALIASES[filter].map((alias) => [
      normalizeLocationTagValue(alias),
      filter,
    ])
  )
);

const LOCATION_RATING_TAG_BY_NORMALIZED_VALUE = new Map<string, LocationRatingTag>(
  LOCATION_RATING_TAGS.map((tag) => [normalizeLocationTagValue(tag), tag])
);

for (const filter of LOCATION_ATMOSPHERE_FILTERS) {
  for (const alias of LOCATION_ATMOSPHERE_TAG_ALIASES[filter]) {
    LOCATION_RATING_TAG_BY_NORMALIZED_VALUE.set(normalizeLocationTagValue(alias), filter);
  }
}

export function normalizeLocationTagValue(tag: unknown) {
  if (typeof tag !== 'string') {
    return '';
  }

  return tag
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function getAtmosphereFiltersForLocationTags(tags: unknown) {
  if (!Array.isArray(tags)) {
    return new Set<LocationAtmosphereFilter>();
  }

  const filters = new Set<LocationAtmosphereFilter>();

  for (const tag of tags) {
    const filter = LOCATION_ATMOSPHERE_ALIAS_LOOKUP.get(normalizeLocationTagValue(tag));

    if (filter) {
      filters.add(filter);
    }
  }

  return filters;
}

export function sanitizeLocationRatingTags(tags: unknown) {
  if (!Array.isArray(tags)) {
    return [];
  }

  const submittedTags = new Set(
    tags
      .map((tag) => LOCATION_RATING_TAG_BY_NORMALIZED_VALUE.get(normalizeLocationTagValue(tag)))
      .filter((tag): tag is LocationRatingTag => Boolean(tag))
  );

  return LOCATION_RATING_TAGS.filter((tag) => submittedTags.has(tag));
}
