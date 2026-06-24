import rawCourseCatalog from '@/data/uw-course-catalog.json';
import { UW_STUDY_LOCATIONS, type OfficialStudyLocation } from '@/data/uw-study-locations';
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

export function findStudyLocationById(locationId: string): OfficialStudyLocation | null {
  return UW_STUDY_LOCATIONS.find((location) => location.locationId === locationId) ?? null;
}
