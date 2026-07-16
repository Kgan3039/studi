const {
  collectSearchTerms,
  matchesSearchTerms,
  normalizeSearchText,
  scoreSearchMatch,
} = require('./catalog-search.js');

function buildSessionSearchRecord(session) {
  return {
    code: session.classId,
    title: session.title,
    subjectCode: session.locationName,
    subjectName: session.hostName,
    searchTerms: collectSearchTerms(
      `${session.classId} ${session.title} ${session.locationName} ${session.hostName}`
    ),
  };
}

function compareAlphabetically(firstSession, secondSession) {
  const classComparison = normalizeSearchText(firstSession.classId).localeCompare(
    normalizeSearchText(secondSession.classId)
  );

  if (classComparison !== 0) {
    return classComparison;
  }

  const titleComparison = normalizeSearchText(firstSession.title).localeCompare(
    normalizeSearchText(secondSession.title)
  );

  if (titleComparison !== 0) {
    return titleComparison;
  }

  return normalizeSearchText(firstSession.locationName).localeCompare(
    normalizeSearchText(secondSession.locationName)
  );
}

function searchSessionsInList(sessions, query) {
  const normalizedQuery = String(query ?? '').trim();

  if (!normalizedQuery) {
    return Array.isArray(sessions) ? sessions.slice() : [];
  }

  return (Array.isArray(sessions) ? sessions : [])
    .filter((session) => matchesSearchTerms(buildSessionSearchRecord(session).searchTerms, normalizedQuery))
    .slice()
    .sort((firstSession, secondSession) => {
      const firstScore = scoreSearchMatch(buildSessionSearchRecord(firstSession), normalizedQuery);
      const secondScore = scoreSearchMatch(buildSessionSearchRecord(secondSession), normalizedQuery);

      if (firstScore !== secondScore) {
        return secondScore - firstScore;
      }

      return compareAlphabetically(firstSession, secondSession);
    });
}

module.exports = {
  searchSessionsInList,
};