import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'mocha';

const read = (path) => readFileSync(path, 'utf8');

function tsxFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return tsxFiles(path);
    }
    return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('text input capitalization defaults', () => {
  const searchBar = read('components/ui/SearchBar.tsx');
  const input = read('components/ui/Input.tsx');

  it('uses sentence capitalization for every shared search bar by default', () => {
    assert.match(searchBar, /autoCapitalize = 'sentences'/);
    assert.match(searchBar, /autoCapitalize=\{autoCapitalize\}/);
    assert.doesNotMatch(searchBar, /autoCapitalize="none"/);
  });

  it('defaults ordinary shared inputs to sentences and secure inputs to none', () => {
    assert.match(
      input,
      /autoCapitalize=\{autoCapitalize \?\? \(secureTextEntry \? 'none' : 'sentences'\)\}/
    );
  });

  it('routes every requested search surface through the shared search bar', () => {
    for (const path of [
      'app/(tabs)/messages.tsx',
      'app/(tabs)/sessions.tsx',
      'app/(tabs)/explore.tsx',
      'app/friends.tsx',
      'app/create-session.tsx',
    ]) {
      assert.match(read(path), /<SearchBar\b/, `${path} must use the shared SearchBar`);
    }
  });
});

describe('direct native text inputs', () => {
  it('assigns an explicit capitalization policy to every direct TextInput', () => {
    let checkedInputs = 0;
    for (const path of [...tsxFiles('app'), ...tsxFiles('components')]) {
      const tags = read(path).match(/<TextInput\b[\s\S]*?\/>/g) ?? [];
      for (const tag of tags) {
        checkedInputs += 1;
        assert.match(tag, /\bautoCapitalize=/, `${path} has a TextInput without a policy`);
      }
    }
    assert.ok(checkedInputs > 0, 'the app must contain at least one direct TextInput');
  });
});
