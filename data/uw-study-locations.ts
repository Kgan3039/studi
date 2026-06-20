export type OfficialStudyLocation = {
  building: string;
  campusArea: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  locationId: string;
  mapPosition: {
    xPercent: number;
    yPercent: number;
  };
  name: string;
  notes: string;
  tags: string[];
};

export const UW_STUDY_LOCATION_COORDINATE_OVERRIDES: Record<
  string,
  OfficialStudyLocation['coordinates']
> = {
  // Building centroids from the official UW campus map API. These IDs are
  // Firestore-only aliases that do not have a full built-in location record.
  ecb: { latitude: 43.0727287, longitude: -89.4134176 },
  'engineering-hall': { latitude: 43.071775, longitude: -89.4103255 },
  'law-library': { latitude: 43.0745525, longitude: -89.4022789 },
  'whs-reading-room': { latitude: 43.0754091, longitude: -89.4000497 },
  'math-library': { latitude: 43.0738749, longitude: -89.4054407 },
  morgridge: { latitude: 43.0728343, longitude: -89.4067959 },
  'steenbock-lib': { latitude: 43.0761102, longitude: -89.4133679 },
  'student-activity-center': { latitude: 43.0723884, longitude: -89.398735 },
  'wsb-library': { latitude: 43.0727121, longitude: -89.401566 },
};

export const UW_STUDY_LOCATIONS: OfficialStudyLocation[] = [
  {
    coordinates: { latitude: 43.0766969, longitude: -89.4013466 },
    locationId: 'college-library',
    mapPosition: { xPercent: 79, yPercent: 55 },
    name: 'College Library',
    building: 'Helen C. White Hall',
    campusArea: 'Central Campus',
    notes: 'Popular late-night library with group study rooms, open seating, and strong student traffic.',
    tags: ['late-night', 'group-study', 'central', 'library'],
  },
  {
    coordinates: { latitude: 43.0753616, longitude: -89.3979787 },
    locationId: 'memorial-library',
    mapPosition: { xPercent: 69, yPercent: 43 },
    name: 'Memorial Library',
    building: 'Memorial Library',
    campusArea: 'Bascom Hill',
    notes: 'Large research library with quiet floors, reading rooms, and a classic study atmosphere.',
    tags: ['quiet', 'library', 'research', 'bascom'],
  },
  {
    coordinates: { latitude: 43.0714672, longitude: -89.4086535 },
    locationId: 'wendt-commons',
    mapPosition: { xPercent: 43, yPercent: 59 },
    name: 'Wendt Commons',
    building: 'Wendt Commons',
    campusArea: 'Engineering Campus',
    notes: 'A go-to collaborative study space for engineering and computer science students.',
    tags: ['engineering', 'collaborative', 'stem', 'popular'],
  },
  {
    coordinates: { latitude: 43.0718561, longitude: -89.4080738 },
    locationId: 'union-south',
    mapPosition: { xPercent: 49, yPercent: 76 },
    name: 'Union South',
    building: 'Union South',
    campusArea: 'South Campus',
    notes: 'Spacious seating, dining nearby, and good casual meetup energy for study sessions.',
    tags: ['casual', 'food-nearby', 'groups', 'south-campus'],
  },
  {
    coordinates: { latitude: 43.076421, longitude: -89.3999144 },
    locationId: 'memorial-union',
    mapPosition: { xPercent: 88, yPercent: 39 },
    name: 'Memorial Union',
    building: 'Memorial Union',
    campusArea: 'Lakeshore',
    notes: 'Iconic campus hangout with varied seating and easy meetup potential near the Terrace.',
    tags: ['social', 'casual', 'landmark', 'lakeshore'],
  },
  {
    coordinates: { latitude: 43.0761102, longitude: -89.4133679 },
    locationId: 'steenbock-library',
    mapPosition: { xPercent: 23, yPercent: 25 },
    name: 'Steenbock Library',
    building: 'Steenbock Library',
    campusArea: 'West Campus',
    notes: 'Strong quiet-study option for science and agriculture students on west campus.',
    tags: ['quiet', 'west-campus', 'science', 'library'],
  },
  {
    coordinates: { latitude: 43.0775312, longitude: -89.4302556 },
    locationId: 'ebling-library',
    mapPosition: { xPercent: 10, yPercent: 39 },
    name: 'Ebling Library',
    building: 'Health Sciences Learning Center',
    campusArea: 'West Campus',
    notes: 'Reliable health sciences study space with quieter corners and professional-school traffic.',
    tags: ['health-sciences', 'quiet', 'west-campus', 'library'],
  },
  {
    coordinates: { latitude: 43.0727121, longitude: -89.401566 },
    locationId: 'business-learning-commons',
    mapPosition: { xPercent: 61, yPercent: 78 },
    name: 'Business Learning Commons',
    building: 'Grainger Hall',
    campusArea: 'South Campus',
    notes: 'Comfortable modern seating with strong access for business students and small groups.',
    tags: ['business', 'modern', 'group-study', 'south-campus'],
  },
  {
    coordinates: { latitude: 43.0728343, longitude: -89.4067959 },
    locationId: 'morgridge-hall',
    mapPosition: { xPercent: 58, yPercent: 65 },
    name: 'Morgridge Hall',
    building: 'Morgridge Hall',
    campusArea: 'South Campus',
    notes: 'Modern academic building with collaborative study areas and a convenient south-campus location.',
    tags: ['modern', 'south-campus', 'collaboration', 'study-rooms'],
  },
  {
    coordinates: { latitude: 43.0766969, longitude: -89.4013466 },
    locationId: 'college-library-cafe',
    mapPosition: { xPercent: 87, yPercent: 61 },
    name: 'College Library Cafe',
    building: 'Helen C. White Hall',
    campusArea: 'Central Campus',
    notes: 'Casual meetup-friendly area near College Library with easy access to Library Mall.',
    tags: ['central', 'casual', 'coffee', 'meetup'],
  },
  {
    coordinates: { latitude: 43.0713081, longitude: -89.4035993 },
    locationId: 'merit-library',
    mapPosition: { xPercent: 72, yPercent: 72 },
    name: 'MERIT Library',
    building: 'Teacher Education Building',
    campusArea: 'South Campus',
    notes: 'Smaller education-focused library space that works well for focused study blocks.',
    tags: ['education', 'quiet', 'small', 'library'],
  },
  {
    coordinates: { latitude: 43.0765289, longitude: -89.4052587 },
    locationId: 'social-science',
    mapPosition: { xPercent: 59, yPercent: 50 },
    name: 'Social Science Building Commons',
    building: 'Social Science Building',
    campusArea: 'Central Campus',
    notes: 'Accessible central meeting point with open tables and good between-class availability.',
    tags: ['central', 'open-seating', 'meetup', 'commons'],
  },
  {
    coordinates: { latitude: 43.0754091, longitude: -89.4000497 },
    locationId: 'wisconsin-historical-society',
    mapPosition: { xPercent: 77, yPercent: 47 },
    name: 'Wisconsin Historical Society Library',
    building: 'Wisconsin Historical Society',
    campusArea: 'Bascom Hill',
    notes: 'Excellent quiet option near Library Mall with a more focused research-style setting.',
    tags: ['quiet', 'research', 'bascom', 'library'],
  },
  {
    coordinates: { latitude: 43.0729048, longitude: -89.408057 },
    locationId: 'parkside',
    mapPosition: { xPercent: 32, yPercent: 56 },
    name: 'DeLuca Forum at Discovery Building',
    building: 'Discovery Building',
    campusArea: 'West Campus',
    notes: 'Open, bright collaborative area that works well for group meetups and flexible sessions.',
    tags: ['collaborative', 'bright', 'west-campus', 'meetup'],
  },
];
