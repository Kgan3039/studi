export function collectSearchTerms(values: string | string[]): string[];
export function matchesSearchTerms(courseTerms: string[], query: string): boolean;
export function normalizeSearchText(value: string): string;
export function scoreSearchMatch(
  course: {
    code: string;
    searchTerms?: string[];
    subjectCode?: string;
    subjectName?: string;
    title: string;
  },
  query: string
): number;
export function searchCoursesInCatalog<T extends { code: string; searchTerms?: string[] }>(
  catalog: T[],
  query: string,
  selectedCodes?: string[],
  limit?: number
): T[];