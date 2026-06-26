import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rawCourseCatalog = require('../data/uw-course-catalog.json');
const catalogSearch = require('../lib/catalog-search.js');

function codesFor(query, selectedCodes = [], limit = 20) {
  return catalogSearch
    .searchCoursesInCatalog(rawCourseCatalog.courses, query, selectedCodes, limit)
    .map((course) => course.code);
}

function normalizedCodesFor(query, selectedCodes = [], limit = 20) {
  return codesFor(query, selectedCodes, limit).map((code) => catalogSearch.normalizeSearchText(code));
}

function firstCourseCodeBySubjectName(subjectName) {
  const course = rawCourseCatalog.courses.find((entry) => entry.subjectName === subjectName);

  if (!course) {
    throw new Error(`Missing subject name in catalog: ${subjectName}`);
  }

  return catalogSearch.normalizeSearchText(course.code);
}

describe('catalog search normalization', () => {
  it('matches compact and abbreviated computer science searches', () => {
    assert.equal(codesFor('COMPSCI200', [], 5)[0], 'COMP SCI 200');
    assert.equal(codesFor('CS 200', [], 5)[0], 'COMP SCI 200');
    assert.ok(codesFor('comp sci 200').includes('COMP SCI 200'));
  });

  it('matches roman numerals and digits for programming courses', () => {
    assert.ok(codesFor('PROGRAMMING 1').includes('COMP SCI 200'));
    assert.ok(codesFor('Programming I').includes('COMP SCI 200'));
  });

  it('matches subject-name searches for English courses', () => {
    assert.ok(codesFor('ENGLISH 177').includes('ENGL 177'));
    assert.ok(codesFor('engl177').includes('ENGL 177'));
  });

  it('matches cross-listed courses by code, abbreviation, and title text', () => {
    const courseCode = 'asian am engl 150';

    assert.ok(normalizedCodesFor('ASIAN AM', [], 50).includes(courseCode));
    assert.ok(normalizedCodesFor('ENGL 150', [], 50).includes(courseCode));
    assert.ok(normalizedCodesFor('Asian American 150', [], 50).includes(courseCode));
    assert.ok(normalizedCodesFor('Literature & Culture of Asian America', [], 50).includes(courseCode));
  });

  it('covers other real subject aliases from the catalog', () => {
    const accountingCode = firstCourseCodeBySubjectName('Accounting and Information Systems');
    const economicsCode = firstCourseCodeBySubjectName('Economics');
    const statisticsCode = firstCourseCodeBySubjectName('Statistics');

    assert.ok(normalizedCodesFor('accounting', [], 500).includes(accountingCode));
    assert.ok(normalizedCodesFor('AIS', [], 500).includes(accountingCode));
    assert.ok(normalizedCodesFor('economics', [], 500).includes(economicsCode));
    assert.ok(normalizedCodesFor('statistics', [], 500).includes(statisticsCode));
  });

  it('still excludes selected courses', () => {
    assert.equal(codesFor('COMP SCI 200', ['COMP SCI 200']).includes('COMP SCI 200'), false);
  });
});