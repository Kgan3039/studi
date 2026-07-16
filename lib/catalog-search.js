const ROMAN_TO_DIGIT = new Map([
  ['i', '1'],
  ['ii', '2'],
  ['iii', '3'],
  ['iv', '4'],
  ['v', '5'],
  ['vi', '6'],
  ['vii', '7'],
  ['viii', '8'],
  ['ix', '9'],
  ['x', '10'],
]);

const DIGIT_TO_ROMAN = new Map([...ROMAN_TO_DIGIT].map(([roman, digit]) => [digit, roman]));

const PHRASE_VARIANTS = [
  ['comp sci', ['cs', 'computer science', 'computer sciences', 'compsci']],
  ['computer science', ['comp sci', 'computer sciences', 'cs', 'compsci']],
  ['computer sciences', ['comp sci', 'computer science', 'cs', 'compsci']],
  ['cs', ['comp sci', 'computer science', 'computer sciences', 'compsci']],
  ['compsci', ['comp sci', 'computer science', 'computer sciences', 'cs']],
  ['english', ['engl']],
  ['engl', ['english']],
  ['asian american', ['asian am', 'asianamerican']],
  ['asian am', ['asian american', 'asianamerican']],
  ['asianamerican', ['asian american', 'asian am']],
];

const ACRONYM_STOPWORDS = new Set(['and', 'for', 'of', 'the', 'to', 'in', '&']);

function coerceString(value) {
  return value == null ? '' : String(value);
}

function normalizeSearchText(value) {
  return coerceString(value)
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAcronym(value) {
  const words = normalizeSearchText(value)
    .split(' ')
    .filter((word) => word && !ACRONYM_STOPWORDS.has(word));

  if (words.length < 2) {
    return '';
  }

  return words.map((word) => word[0]).join('');
}

function addVariantsFromText(target, value) {
  const normalized = normalizeSearchText(value);

  if (!normalized) {
    return;
  }

  const compact = normalized.replace(/\s+/g, '');
  const seeds = new Set([normalized, compact]);

  for (const seed of [...seeds]) {
    const romanExpanded = seed.replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, (match) =>
      ROMAN_TO_DIGIT.get(match) ?? match
    );
    seeds.add(romanExpanded);

    const digitExpanded = seed.replace(/\b(1|2|3|4|5|6|7|8|9|10)\b/g, (match) =>
      DIGIT_TO_ROMAN.get(match) ?? match
    );
    seeds.add(digitExpanded);
  }

  for (const seed of [...seeds]) {
    target.add(seed);

    for (const [pattern, replacements] of PHRASE_VARIANTS) {
      if (seed.includes(pattern)) {
        for (const replacement of replacements) {
          target.add(seed.replaceAll(pattern, replacement));
        }
      }
    }
  }

  const acronym = buildAcronym(normalized);
  if (acronym) {
    target.add(acronym);
  }
}

function collectSearchTerms(values) {
  const terms = new Set();
  const inputValues = Array.isArray(values) ? values : [values];

  for (const value of inputValues) {
    addVariantsFromText(terms, value);
  }

  return [...terms].filter(Boolean);
}

function matchesSearchTerms(courseTerms, query) {
  const queryTokens = normalizeSearchText(query).split(' ').filter(Boolean);

  if (queryTokens.length === 0) {
    return true;
  }

  const candidateTokens = new Set();

  for (const term of courseTerms) {
    for (const token of normalizeSearchText(term).split(' ').filter(Boolean)) {
      candidateTokens.add(token);
    }
  }

  return queryTokens.every((queryToken) => {
    for (const candidateToken of candidateTokens) {
      if (queryToken === candidateToken) {
        return true;
      }

      if (ROMAN_TO_DIGIT.get(queryToken) === candidateToken) {
        return true;
      }

      if (DIGIT_TO_ROMAN.get(queryToken) === candidateToken) {
        return true;
      }

      if (
        (queryToken.length >= 3 && candidateToken.startsWith(queryToken)) ||
        (candidateToken.length >= 3 && queryToken.startsWith(candidateToken))
      ) {
        return true;
      }
    }

    return false;
  });
}

function getCourseSearchText(course) {
  return normalizeSearchText(
    `${coerceString(course.code)} ${coerceString(course.title)} ${coerceString(course.subjectCode)} ${coerceString(course.subjectName)}`
  );
}

function getCourseSearchTerms(course) {
  return (
    course.searchTerms ??
    collectSearchTerms(
      `${coerceString(course.code)} ${coerceString(course.title)} ${coerceString(course.subjectCode)} ${coerceString(course.subjectName)}`
    )
  );
}

function buildTokenSet(values) {
  const tokens = new Set();

  for (const value of values) {
    for (const token of normalizeSearchText(value).split(' ').filter(Boolean)) {
      tokens.add(token);
    }
  }

  return tokens;
}

function scoreSearchMatch(course, query) {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return 0;
  }

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  const primaryText = getCourseSearchText(course);
  const primaryTokens = buildTokenSet([
    coerceString(course.code),
    coerceString(course.title),
    coerceString(course.subjectCode),
    coerceString(course.subjectName),
  ]);
  const aliasTokens = buildTokenSet(getCourseSearchTerms(course));
  const candidateTokens = new Set([...primaryTokens, ...aliasTokens]);

  let score = 0;

  if (primaryText === normalizedQuery) {
    score += 1000;
  } else if (primaryText.startsWith(normalizedQuery)) {
    score += 500;
  } else if (primaryText.includes(normalizedQuery)) {
    score += 250;
  }

  for (const queryToken of queryTokens) {
    let tokenScore = 0;

    if (primaryTokens.has(queryToken)) {
      tokenScore = 60;
    } else if (candidateTokens.has(queryToken)) {
      tokenScore = 45;
    } else {
      for (const candidateToken of candidateTokens) {
        if (ROMAN_TO_DIGIT.get(queryToken) === candidateToken || DIGIT_TO_ROMAN.get(queryToken) === candidateToken) {
          tokenScore = 40;
          break;
        }

        if (queryToken.length >= 3 && candidateToken.startsWith(queryToken)) {
          tokenScore = Math.max(tokenScore, 30);
        }

        if (candidateToken.length >= 3 && queryToken.startsWith(candidateToken)) {
          tokenScore = Math.max(tokenScore, 20);
        }
      }
    }

    score += tokenScore;
  }

  return score;
}

function searchCoursesInCatalog(catalog, query, selectedCodes = [], limit = 30) {
  const selectedSet = new Set(selectedCodes.map((code) => coerceString(code).trim().toUpperCase()));
  const normalizedQuery = coerceString(query).trim();

  const visibleCourses = normalizedQuery
    ? catalog.filter((course) => {
        const courseCode = coerceString(course.code).trim().toUpperCase();

        return (
          !selectedSet.has(courseCode) &&
          matchesSearchTerms(getCourseSearchTerms(course), normalizedQuery)
        );
      })
    : catalog.filter((course) => !selectedSet.has(coerceString(course.code).trim().toUpperCase()));

  return visibleCourses
    .slice()
    .sort((firstCourse, secondCourse) => {
      const firstScore = scoreSearchMatch(firstCourse, normalizedQuery);
      const secondScore = scoreSearchMatch(secondCourse, normalizedQuery);

      if (firstScore !== secondScore) {
        return secondScore - firstScore;
      }

      const codeComparison = normalizeSearchText(firstCourse.code).localeCompare(
        normalizeSearchText(secondCourse.code)
      );

      if (codeComparison !== 0) {
        return codeComparison;
      }

      return normalizeSearchText(firstCourse.title).localeCompare(normalizeSearchText(secondCourse.title));
    })
    .slice(0, limit);
}

module.exports = {
  collectSearchTerms,
  buildAcronym,
  matchesSearchTerms,
  normalizeSearchText,
  scoreSearchMatch,
  searchCoursesInCatalog,
};