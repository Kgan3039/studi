import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { searchSessionsInList } = require('../lib/session-search.js');

function session(sessionId, classId, title, locationName, hostName) {
  return { sessionId, classId, title, locationName, hostName };
}

describe('session search normalization', () => {
  it('matches inclusive course-like aliases', () => {
    const sessions = [
      session('1', 'STAT 240', 'Intro to Statistics', 'Red Gym', 'Avery'),
      session('2', 'COMP SCI 200', 'Programming I', 'Bascom Hall', 'Blair'),
    ];

    assert.equal(searchSessionsInList(sessions, 'stats240')[0].sessionId, '1');
    assert.equal(searchSessionsInList(sessions, 'cs')[0].sessionId, '2');
    assert.equal(searchSessionsInList(sessions, 'computer science')[0].sessionId, '2');
    assert.ok(searchSessionsInList(sessions, 'math 222 final').length === 0);
  });

  it('ranks the closest match first', () => {
    const sessions = [
      session('1', 'MATH 222', 'Final Review', 'Baker Hall', 'Casey'),
      session('2', 'MATH 222', 'Final Review', 'Allen Hall', 'Casey'),
      session('3', 'MATH 222', 'Final Review Night', 'Corliss Hall', 'Casey'),
    ];

    const results = searchSessionsInList(sessions, 'math 222 final');

    assert.deepEqual(results.map((session) => session.sessionId), ['2', '1', '3']);
  });

  it('keeps alphabetical order when scores tie', () => {
    const sessions = [
      session('1', 'MATH 222', 'Study Table', 'Zeta Hall', 'Casey'),
      session('2', 'MATH 222', 'Study Table', 'Alpha Hall', 'Casey'),
    ];

    const results = searchSessionsInList(sessions, 'math 222');

    assert.deepEqual(results.map((session) => session.locationName), ['Alpha Hall', 'Zeta Hall']);
  });
});