import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { matchesSessionSearch, normalizeSearchValue } = require('../lib/session-search.js');

/** Fields in the order the Sessions screen passes them. */
function sessionFields({
  classId = 'STAT 240',
  title = 'STAT 240 Study Session',
  locationName = 'College Library',
  hostName = 'Maya Patel',
} = {}) {
  return [classId, title, locationName, hostName];
}

describe('normalizeSearchValue', () => {
  it('lowercases and strips whitespace, hyphens, and underscores', () => {
    assert.equal(normalizeSearchValue('  STAT 240  '), 'stat240');
    assert.equal(normalizeSearchValue('STAT-240'), 'stat240');
    assert.equal(normalizeSearchValue('stat_240'), 'stat240');
    assert.equal(normalizeSearchValue('StAt 240'), 'stat240');
  });

  it('strips slashes and other punctuation (cross-listed codes)', () => {
    assert.equal(normalizeSearchValue('ENTOM/ENVIR ST 201'), 'entomenvirst201');
    assert.equal(normalizeSearchValue('entom-envir st 201'), 'entomenvirst201');
    assert.equal(normalizeSearchValue('★ College Library!'), 'collegelibrary');
  });

  it('returns an empty string for null-ish input', () => {
    assert.equal(normalizeSearchValue(null), '');
    assert.equal(normalizeSearchValue(undefined), '');
    assert.equal(normalizeSearchValue(''), '');
  });
});

describe('matchesSessionSearch', () => {
  it('matches course codes with and without spaces', () => {
    assert.equal(matchesSessionSearch(sessionFields(), 'stat 240'), true);
    assert.equal(matchesSessionSearch(sessionFields(), 'stat240'), true);
    assert.equal(matchesSessionSearch(sessionFields({ classId: 'CS 300' }), 'cs300'), true);
    assert.equal(matchesSessionSearch(sessionFields({ classId: 'MATH 340' }), 'math340'), true);
    assert.equal(matchesSessionSearch(sessionFields({ classId: 'ECE 252' }), 'ece252'), true);
  });

  it('matches hyphens, underscores, and mixed case', () => {
    assert.equal(matchesSessionSearch(sessionFields({ classId: 'CS 300' }), 'CS-300'), true);
    assert.equal(matchesSessionSearch(sessionFields(), 'stat_240'), true);
    assert.equal(matchesSessionSearch(sessionFields(), 'StAt240'), true);
  });

  it('matches multi-word subjects compact or spaced', () => {
    const fields = sessionFields({ classId: 'COMP SCI 400', title: 'PS4 grind' });

    assert.equal(matchesSessionSearch(fields, 'comp sci 400'), true);
    assert.equal(matchesSessionSearch(fields, 'compsci400'), true);
    assert.equal(matchesSessionSearch(fields, 'comp-sci 400'), true);
  });

  it('matches cross-listed courses without exact slash formatting', () => {
    const fields = sessionFields({ classId: 'ENTOM/ENVIR ST 201', title: 'Exam review' });

    assert.equal(matchesSessionSearch(fields, 'entom-envir st 201'), true);
    assert.equal(matchesSessionSearch(fields, 'entom envir st 201'), true);
    assert.equal(matchesSessionSearch(fields, 'entomenvirst201'), true);
    assert.equal(matchesSessionSearch(fields, 'envir st'), true);
  });

  it('still matches titles, locations, and host names', () => {
    assert.equal(matchesSessionSearch(sessionFields(), 'study session'), true);
    assert.equal(matchesSessionSearch(sessionFields(), 'college library'), true);
    assert.equal(matchesSessionSearch(sessionFields(), 'collegelibrary'), true);
    assert.equal(matchesSessionSearch(sessionFields(), 'maya'), true);
    assert.equal(matchesSessionSearch(sessionFields(), 'Maya P'), true);
  });

  it('keeps matching queries that span a field boundary, as before', () => {
    // Pre-helper behavior substring-matched the space-joined fields, so
    // "240 study" (classId into title) must keep working.
    assert.equal(matchesSessionSearch(sessionFields({ title: 'Study Session' }), '240 study'), true);
  });

  it('matches everything on an empty or whitespace-only query', () => {
    assert.equal(matchesSessionSearch(sessionFields(), ''), true);
    assert.equal(matchesSessionSearch(sessionFields(), '   '), true);
  });

  it('rejects queries that appear in no field', () => {
    assert.equal(matchesSessionSearch(sessionFields(), 'chem 103'), false);
    assert.equal(matchesSessionSearch(sessionFields(), 'jordan'), false);
    assert.equal(matchesSessionSearch(sessionFields(), 'stat241'), false);
  });
});
