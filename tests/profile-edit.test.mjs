import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import profileEditModule from '../lib/profile-edit.js';
import sheetScrollModule from '../lib/sheet-keyboard-scroll.js';

const {
  SAFE_PROFILE_SAVE_AUTH_ERROR,
  SAFE_PROFILE_SAVE_ERROR,
  SAFE_PROFILE_SAVE_NETWORK_ERROR,
  SAFE_PROFILE_MODERATION_ERROR,
  getProfileSaveErrorMessage,
  stripProfileIdentityEmoji,
} = profileEditModule;
const { getKeyboardScrollOffset } = sheetScrollModule;

describe('profile identity emoji sanitizer', () => {
  it('removes ordinary emoji and emoji-only input', () => {
    assert.equal(stripProfileIdentityEmoji('Alex 😀 Rivera'), 'Alex  Rivera');
    assert.equal(stripProfileIdentityEmoji('😀'), '');
  });

  it('removes skin-tone modifiers and ZWJ family sequences completely', () => {
    assert.equal(stripProfileIdentityEmoji('Jordan 👍🏽'), 'Jordan ');
    assert.equal(stripProfileIdentityEmoji('Sam 👨‍👩‍👧‍👦'), 'Sam ');
  });

  it('removes country and subdivision flags without residual tag characters', () => {
    const englandFlag = '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
    assert.equal(stripProfileIdentityEmoji(`Lee 🇺🇸${englandFlag}`), 'Lee ');
  });

  it('removes keycaps and both emoji/text variation selectors', () => {
    assert.equal(stripProfileIdentityEmoji('A 1️⃣ B'), 'A  B');
    assert.equal(stripProfileIdentityEmoji('A ❤️ ☕︎ B'), 'A   B');
  });

  it('preserves accented, apostrophized, hyphenated, CJK, and combining text', () => {
    const legitimate = "José O'Connor-Smith O’Malley 李小龙 Renée e\u0301";
    assert.equal(stripProfileIdentityEmoji(legitimate), legitimate);
  });
});

describe('profile save error mapping', () => {
  it('uses fixed copy for moderated profile text', () => {
    assert.equal(
      getProfileSaveErrorMessage({ name: 'ObjectionableContentError', message: 'raw content' }),
      SAFE_PROFILE_MODERATION_ERROR
    );
  });
  it('uses fixed authentication and verification guidance', () => {
    for (const code of [
      'unauthenticated',
      'auth/user-disabled',
      'auth/user-token-expired',
      'auth/invalid-user-token',
    ]) {
      assert.equal(getProfileSaveErrorMessage({ code }), SAFE_PROFILE_SAVE_AUTH_ERROR);
    }
  });

  it('uses fixed retryable copy for network failures', () => {
    for (const code of ['unavailable', 'deadline-exceeded', 'auth/network-request-failed']) {
      assert.equal(getProfileSaveErrorMessage({ code }), SAFE_PROFILE_SAVE_NETWORK_ERROR);
    }
  });

  it('maps permission denial and arbitrary errors to generic safe copy', () => {
    assert.equal(
      getProfileSaveErrorMessage({ code: 'permission-denied', message: 'rules internals' }),
      SAFE_PROFILE_SAVE_ERROR
    );
    assert.equal(
      getProfileSaveErrorMessage(new Error('sensitive backend detail')),
      SAFE_PROFILE_SAVE_ERROR
    );
    assert.equal(getProfileSaveErrorMessage('unexpected'), SAFE_PROFILE_SAVE_ERROR);
  });
});

describe('sheet keyboard scroll offset', () => {
  it('does not scroll a target already inside the viewport', () => {
    assert.equal(
      getKeyboardScrollOffset({ targetY: 100, targetHeight: 80, viewportHeight: 300, gap: 16 }),
      0
    );
  });

  it('positions a covered target just above the viewport boundary', () => {
    assert.equal(
      getKeyboardScrollOffset({ targetY: 280, targetHeight: 100, viewportHeight: 300, gap: 16 }),
      96
    );
  });

  it('fails safely for invalid measurements', () => {
    assert.equal(
      getKeyboardScrollOffset({ targetY: Number.NaN, targetHeight: 10, viewportHeight: 100 }),
      0
    );
    assert.equal(
      getKeyboardScrollOffset({ targetY: 10, targetHeight: 10, viewportHeight: 0 }),
      0
    );
  });
});

describe('Edit Profile production wiring', () => {
  const editorSource = readFileSync('components/profile/ProfileEditSheet.tsx', 'utf8');
  const profileSource = readFileSync('app/(tabs)/profile.tsx', 'utf8');
  const settingsSource = readFileSync('app/settings.tsx', 'utf8');
  const sheetSource = readFileSync('components/ui/Sheet.tsx', 'utf8');

  it('sanitizes all four identity fields during editing and saving', () => {
    for (const field of ['FirstName', 'LastName', 'Major', 'Pronouns']) {
      assert.match(editorSource, new RegExp(`set${field}\\(stripProfileIdentityEmoji\\(value\\)\\)`));
    }
    assert.match(editorSource, /stripProfileIdentityEmoji\(firstName\)\.trim\(\)/);
    assert.match(editorSource, /stripProfileIdentityEmoji\(lastName\)\.trim\(\)/);
    assert.match(editorSource, /major: stripProfileIdentityEmoji\(major\)\.trim\(\)/);
    assert.match(editorSource, /pronouns: stripProfileIdentityEmoji\(pronouns\)\.trim\(\)/);
  });

  it('leaves bio input and persistence untouched by the sanitizer', () => {
    const detailsBlock = editorSource.slice(
      editorSource.indexOf('const details = {'),
      editorSource.indexOf('const nameChanged')
    );
    const bioInput = editorSource.slice(
      editorSource.indexOf('placeholder="What are you studying toward?"') - 250,
      editorSource.indexOf('placeholder="What are you studying toward?"') + 250
    );
    assert.match(detailsBlock, /bio: bio\.trim\(\)/);
    assert.doesNotMatch(detailsBlock.match(/bio:.*$/m)?.[0] ?? '', /stripProfileIdentityEmoji/);
    assert.match(bioInput, /onChangeText=\{setBio\}/);
    assert.doesNotMatch(bioInput, /stripProfileIdentityEmoji/);
  });

  it('never renders arbitrary errors from the profile save path', () => {
    const saveBody = editorSource.slice(
      editorSource.indexOf('async function handleSave'),
      editorSource.indexOf('const placeholderColor')
    );
    assert.match(saveBody, /getProfileSaveErrorMessage\(error\)/);
    assert.doesNotMatch(saveBody, /error\.message/);
  });

  it('preserves drafts on close while clearing transient bio scroll state', () => {
    const closeBody = editorSource.slice(
      editorSource.indexOf('function handleClose'),
      editorSource.indexOf('async function handleSave')
    );
    assert.match(closeBody, /setIsBioFocused\(false\)/);
    assert.match(closeBody, /setBioLayout\(null\)/);
    assert.doesNotMatch(closeBody, /set(?:FirstName|LastName|Major|Year|Pronouns|Bio)\(/);
  });

  it('opens the shared editor over Settings without switching to the Profile tab', () => {
    assert.match(settingsSource, /onPress=\{\(\) => setIsEditingProfile\(true\)\}/);
    assert.match(settingsSource, /<ProfileEditSheet/);
    assert.match(settingsSource, /visible=\{isEditingProfile\}/);
    assert.doesNotMatch(settingsSource, /router\.(replace|push).*profile/);
    assert.match(profileSource, /<ProfileEditSheet/);
  });

  it('keeps keyboard padding opt-in for existing Sheet callers', () => {
    assert.match(sheetSource, /keyboardScrollTarget !== undefined/);
    assert.match(sheetSource, /scroll && keyboardScrollingEnabled/);
    assert.match(sheetSource, /\) : scroll \? \(/);
  });
});
