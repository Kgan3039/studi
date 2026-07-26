import rawCourseCatalog from '@/data/uw-course-catalog.json';
import {
  UW_STUDY_LOCATIONS,
  UW_STUDY_LOCATION_ALIASES,
  type OfficialStudyLocation,
} from '@/data/uw-study-locations';
import * as catalogSearch from './catalog-search.js';

export type CatalogCourse = {
  code: string;
  credits: string;
  description: string;
  searchText: string;
  searchTerms: string[];
  subjectCode: string;
  subjectName: string;
  title: string;
  url: string;
};

type RawCatalogCourse = CatalogCourse & {
  subjectSlug?: string;
};

function decodeGuideArtifacts(value: string) {
  return value
    .replace(/&&#8203;/g, '&')
    .replace(/&#8203;/g, '')
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCourse(rawCourse: RawCatalogCourse): CatalogCourse {
  const code = decodeGuideArtifacts(rawCourse.code);
  const title = decodeGuideArtifacts(rawCourse.title);
  const subjectCode = decodeGuideArtifacts(rawCourse.subjectCode);
  const subjectName = decodeGuideArtifacts(rawCourse.subjectName);
  const description = decodeGuideArtifacts(rawCourse.description);
  const credits = decodeGuideArtifacts(rawCourse.credits);

  return {
    code,
    title,
    credits,
    description,
    subjectCode,
    subjectName,
    url: rawCourse.url,
    searchText: `${code} ${title} ${subjectCode} ${subjectName}`.toLowerCase(),
    searchTerms: catalogSearch.collectSearchTerms(
      `${code} ${title} ${subjectCode} ${subjectName}`
    ),
  };
}

const dedupedCourses = (() => {
  const uniqueCourses = new Map<string, CatalogCourse>();

  for (const rawCourse of rawCourseCatalog.courses as RawCatalogCourse[]) {
    const normalizedCourse = normalizeCourse(rawCourse);
    const key = `${normalizedCourse.code}|${normalizedCourse.title}`;

    if (!uniqueCourses.has(key)) {
      uniqueCourses.set(key, normalizedCourse);
    }
  }

  return [...uniqueCourses.values()].sort((firstCourse, secondCourse) =>
    firstCourse.code.localeCompare(secondCourse.code)
  );
})();

export const UW_COURSE_CATALOG = dedupedCourses;
export const UW_COURSE_COUNT = UW_COURSE_CATALOG.length;

export function searchCourses(query: string, selectedCodes: string[] = [], limit = 30) {
  return catalogSearch.searchCoursesInCatalog(UW_COURSE_CATALOG, query, selectedCodes, limit);
}

export function searchStudyLocations(query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return UW_STUDY_LOCATIONS;
  }

  return UW_STUDY_LOCATIONS.filter((location) => {
    const searchText = [
      location.name,
      location.building,
      location.campusArea,
      location.notes,
      ...location.tags,
    ]
      .join(' ')
      .toLowerCase();

    return searchText.includes(normalizedQuery);
  });
}

export function canonicalStudyLocationId(locationId: string): string {
  return UW_STUDY_LOCATION_ALIASES[locationId] ?? locationId;
}

export function findStudyLocationById(locationId: string): OfficialStudyLocation | null {
  const canonicalId = canonicalStudyLocationId(locationId);
  return UW_STUDY_LOCATIONS.find((location) => location.locationId === canonicalId) ?? null;
}

// Last-resort label for ids with no curated record and no stored name:
// "math-library" → "Math Library". Never surfaces the raw slug.
export function formatStudyLocationLabel(locationId: string): string {
  const label = locationId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

  return label || 'Campus study spot';
}

// The UW catalog stores every title in all caps ("PRINCIPLES OF
// MICROECONOMICS"). Shouting is not hierarchy, so titles are cased for display.
const TITLE_MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'nor', 'of',
  'on', 'or', 'the', 'to', 'via', 'with',
]);
const ROMAN_NUMERAL = /^(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3})$/;
// Kept uppercase because the lowercase form reads as a different word.
const TITLE_ACRONYMS = new Set(['us', 'uk', 'ai', 'it', 'hr', 'gis', 'dna', 'rna']);

/** Convert an all-caps catalog title to readable title case. */
export function formatCourseTitle(title: string): string {
  const words = title.trim().toLowerCase().split(/\s+/).filter(Boolean);

  return words
    .map((word, index) => {
      // Split on punctuation so "micro-economics" and "genetics/genomics"
      // capitalize on both sides.
      return word
        .split(/([-/:])/)
        .map((part, partIndex) => {
          if (!/[a-z0-9]/.test(part)) {
            return part;
          }
          if (ROMAN_NUMERAL.test(part) || TITLE_ACRONYMS.has(part)) {
            return part.toUpperCase();
          }
          if (index > 0 && partIndex === 0 && TITLE_MINOR_WORDS.has(part)) {
            return part;
          }
          return part[0].toUpperCase() + part.slice(1);
        })
        .join('');
    })
    .join(' ');
}

export function getStudyLocationDisplayName(
  locationId: string,
  preferredName?: string | null
): string {
  const trimmedName = preferredName?.trim();

  if (trimmedName && trimmedName !== locationId) {
    return trimmedName;
  }

  return findStudyLocationById(locationId)?.name ?? formatStudyLocationLabel(locationId);
}
