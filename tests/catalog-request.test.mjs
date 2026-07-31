import { strict as assert } from 'node:assert';

import catalogRequest from '../lib/catalog-request.js';

const {
  CATALOG_REQUEST_ERROR_MESSAGES,
  CatalogRequestError,
  catalogRequestErrorMessage,
  hasTextualLocationMatch,
  isCatalogRequestCooldownActive,
  shouldOfferLocationRequest,
} = catalogRequest;

describe('catalog request location prompting', () => {
  const searchableLocations = [
    'College Library Helen C. White southeast campus open late',
    'Memorial Library State Street quiet',
  ];

  it('offers a request when no existing location text matches', () => {
    assert.equal(shouldOfferLocationRequest('Science Hall', searchableLocations), true);
  });

  it('does not offer a request when a textual match is hidden by secondary filters', () => {
    // The helper intentionally receives the unfiltered catalog text, not the
    // filtered result list (which may be empty).
    assert.equal(shouldOfferLocationRequest('College Library', searchableLocations), false);
  });

  it('does not offer a request when a textual match is visible', () => {
    assert.equal(hasTextualLocationMatch('memorial', searchableLocations), true);
    assert.equal(shouldOfferLocationRequest('memorial', searchableLocations), false);
  });

  it('collapses repeated spaces before matching', () => {
    assert.equal(hasTextualLocationMatch('College   Library', searchableLocations), true);
  });

  it('treats tabs and newlines as ordinary whitespace', () => {
    assert.equal(hasTextualLocationMatch('College\t\nLibrary', searchableLocations), true);
  });

  it('ignores leading and trailing whitespace', () => {
    assert.equal(hasTextualLocationMatch('  College Library  ', searchableLocations), true);
  });

  it('matches case-insensitively', () => {
    assert.equal(hasTextualLocationMatch('COLLEGE LIBRARY', searchableLocations), true);
  });

  it('preserves partial-match behavior', () => {
    assert.equal(hasTextualLocationMatch('lege libr', searchableLocations), true);
  });

  it('still offers a request for genuinely different text', () => {
    assert.equal(shouldOfferLocationRequest('Science Hall', searchableLocations), true);
  });
});

describe('catalog request cooldown', () => {
  const now = 1_000_000;

  it('treats a recent request as active and an elapsed cooldown as available', () => {
    assert.equal(isCatalogRequestCooldownActive(now - 60_000, now), true);
    assert.equal(isCatalogRequestCooldownActive(now - 10 * 60_000, now), false);
  });
});

describe('catalog request error mapping', () => {
  it('maps explicit cooldown and invalid domain errors', () => {
    const cooldownError = new CatalogRequestError('catalog-request/cooldown');
    const invalidError = new CatalogRequestError('catalog-request/invalid');

    assert.equal(cooldownError.code, 'catalog-request/cooldown');
    assert.equal(cooldownError.message, CATALOG_REQUEST_ERROR_MESSAGES.cooldown);
    assert.equal(catalogRequestErrorMessage(cooldownError), CATALOG_REQUEST_ERROR_MESSAGES.cooldown);
    assert.equal(invalidError.code, 'catalog-request/invalid');
    assert.equal(invalidError.message, CATALOG_REQUEST_ERROR_MESSAGES.invalid);
    assert.equal(catalogRequestErrorMessage(invalidError), CATALOG_REQUEST_ERROR_MESSAGES.invalid);
  });

  it('maps authentication and stale verification failures safely', () => {
    assert.equal(
      catalogRequestErrorMessage({ code: 'permission-denied' }),
      CATALOG_REQUEST_ERROR_MESSAGES.auth
    );
    assert.equal(
      catalogRequestErrorMessage({ code: 'auth/user-token-expired' }),
      CATALOG_REQUEST_ERROR_MESSAGES.auth
    );
  });

  it('maps invalid, network, and unavailable failures safely', () => {
    assert.equal(
      catalogRequestErrorMessage({ code: 'invalid-argument' }),
      CATALOG_REQUEST_ERROR_MESSAGES.invalid
    );
    assert.equal(
      catalogRequestErrorMessage({ code: 'unavailable' }),
      CATALOG_REQUEST_ERROR_MESSAGES.network
    );
    assert.equal(
      catalogRequestErrorMessage({ code: 'auth/network-request-failed' }),
      CATALOG_REQUEST_ERROR_MESSAGES.network
    );
  });

  it('never exposes arbitrary or unknown error messages', () => {
    const secret = new Error('projects/studi-b02c3/internal/path');
    assert.equal(catalogRequestErrorMessage(secret), CATALOG_REQUEST_ERROR_MESSAGES.generic);
    assert.equal(catalogRequestErrorMessage({ code: 'internal', message: 'backend detail' }),
      CATALOG_REQUEST_ERROR_MESSAGES.generic);
    assert.equal(catalogRequestErrorMessage(null), CATALOG_REQUEST_ERROR_MESSAGES.generic);
  });
});
