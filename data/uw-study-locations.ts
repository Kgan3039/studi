export type OfficialStudyLocation = {
  building: string;
  campusArea: string;
  locationId: string;
  name: string;
  notes: string;
  tags: string[];
};

export const UW_STUDY_LOCATIONS: OfficialStudyLocation[] = [
  {
    locationId: 'college-library',
    name: 'College Library',
    building: 'Helen C. White Hall',
    campusArea: 'Central Campus',
    notes: 'Popular late-night library with group study rooms, open seating, and strong student traffic.',
    tags: ['late-night', 'group-study', 'central', 'library'],
  },
  {
    locationId: 'memorial-library',
    name: 'Memorial Library',
    building: 'Memorial Library',
    campusArea: 'Bascom Hill',
    notes: 'Large research library with quiet floors, reading rooms, and a classic study atmosphere.',
    tags: ['quiet', 'library', 'research', 'bascom'],
  },
  {
    locationId: 'wendt-commons',
    name: 'Wendt Commons',
    building: 'Wendt Commons',
    campusArea: 'Engineering Campus',
    notes: 'A go-to collaborative study space for engineering and computer science students.',
    tags: ['engineering', 'collaborative', 'stem', 'popular'],
  },
  {
    locationId: 'union-south',
    name: 'Union South',
    building: 'Union South',
    campusArea: 'South Campus',
    notes: 'Spacious seating, dining nearby, and good casual meetup energy for study sessions.',
    tags: ['casual', 'food-nearby', 'groups', 'south-campus'],
  },
  {
    locationId: 'memorial-union',
    name: 'Memorial Union',
    building: 'Memorial Union',
    campusArea: 'Lakeshore',
    notes: 'Iconic campus hangout with varied seating and easy meetup potential near the Terrace.',
    tags: ['social', 'casual', 'landmark', 'lakeshore'],
  },
  {
    locationId: 'steenbock-library',
    name: 'Steenbock Library',
    building: 'Steenbock Library',
    campusArea: 'West Campus',
    notes: 'Strong quiet-study option for science and agriculture students on west campus.',
    tags: ['quiet', 'west-campus', 'science', 'library'],
  },
  {
    locationId: 'ebling-library',
    name: 'Ebling Library',
    building: 'Health Sciences Learning Center',
    campusArea: 'West Campus',
    notes: 'Reliable health sciences study space with quieter corners and professional-school traffic.',
    tags: ['health-sciences', 'quiet', 'west-campus', 'library'],
  },
  {
    locationId: 'business-learning-commons',
    name: 'Business Learning Commons',
    building: 'Grainger Hall',
    campusArea: 'South Campus',
    notes: 'Comfortable modern seating with strong access for business students and small groups.',
    tags: ['business', 'modern', 'group-study', 'south-campus'],
  },
  {
    locationId: 'morgridge-hall',
    name: 'Morgridge Hall',
    building: 'Morgridge Hall',
    campusArea: 'South Campus',
    notes: 'Modern academic building with collaborative study areas and a convenient south-campus location.',
    tags: ['modern', 'south-campus', 'collaboration', 'study-rooms'],
  },
  {
    locationId: 'college-library-cafe',
    name: 'College Library Cafe',
    building: 'Helen C. White Hall',
    campusArea: 'Central Campus',
    notes: 'Casual meetup-friendly area near College Library with easy access to Library Mall.',
    tags: ['central', 'casual', 'coffee', 'meetup'],
  },
  {
    locationId: 'merit-library',
    name: 'MERIT Library',
    building: 'Teacher Education Building',
    campusArea: 'South Campus',
    notes: 'Smaller education-focused library space that works well for focused study blocks.',
    tags: ['education', 'quiet', 'small', 'library'],
  },
  {
    locationId: 'social-science',
    name: 'Social Science Building Commons',
    building: 'Social Science Building',
    campusArea: 'Central Campus',
    notes: 'Accessible central meeting point with open tables and good between-class availability.',
    tags: ['central', 'open-seating', 'meetup', 'commons'],
  },
  {
    locationId: 'wisconsin-historical-society',
    name: 'Wisconsin Historical Society Library',
    building: 'Wisconsin Historical Society',
    campusArea: 'Bascom Hill',
    notes: 'Excellent quiet option near Library Mall with a more focused research-style setting.',
    tags: ['quiet', 'research', 'bascom', 'library'],
  },
  {
    locationId: 'parkside',
    name: 'DeLuca Forum at Discovery Building',
    building: 'Discovery Building',
    campusArea: 'West Campus',
    notes: 'Open, bright collaborative area that works well for group meetups and flexible sessions.',
    tags: ['collaborative', 'bright', 'west-campus', 'meetup'],
  },
];
