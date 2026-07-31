const CATALOG_REQUEST_COOLDOWN_MS = 10 * 60 * 1000;

const CATALOG_REQUEST_ERROR_MESSAGES = {
  cooldown:
    "You can submit only one course or study spot request every 10 minutes. Please try again later.",
  auth: "Your sign-in or email verification is out of date. Sign in again and verify your UW email.",
  invalid: "Check the request name and details, then try again.",
  network: "Check your connection and try again.",
  generic: "Unable to submit your request right now.",
};

class CatalogRequestError extends Error {
  constructor(code) {
    super(catalogRequestErrorMessage({ code }));
    this.name = "CatalogRequestError";
    this.code = code;
  }
}

function errorCode(error) {
  return error && typeof error === "object" && typeof error.code === "string"
    ? error.code
    : "";
}

function catalogRequestErrorMessage(error) {
  const code = errorCode(error);

  if (code === "catalog-request/cooldown") {
    return CATALOG_REQUEST_ERROR_MESSAGES.cooldown;
  }
  if (code === "catalog-request/invalid" || code === "invalid-argument") {
    return CATALOG_REQUEST_ERROR_MESSAGES.invalid;
  }
  if (
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    code === "auth/network-request-failed"
  ) {
    return CATALOG_REQUEST_ERROR_MESSAGES.network;
  }
  if (
    code === "permission-denied" ||
    code === "unauthenticated" ||
    code.startsWith("auth/")
  ) {
    return CATALOG_REQUEST_ERROR_MESSAGES.auth;
  }
  return CATALOG_REQUEST_ERROR_MESSAGES.generic;
}

function isCatalogRequestCooldownActive(updatedAtMillis, nowMillis = Date.now()) {
  return (
    Number.isFinite(updatedAtMillis) &&
    Number.isFinite(nowMillis) &&
    updatedAtMillis > nowMillis - CATALOG_REQUEST_COOLDOWN_MS
  );
}

function normalizeCatalogSearchText(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/\s+/g, " ")
    : "";
}

function hasTextualLocationMatch(searchQuery, searchableLocationText) {
  const normalizedQuery = normalizeCatalogSearchText(searchQuery);
  if (!normalizedQuery || !Array.isArray(searchableLocationText)) {
    return false;
  }

  return searchableLocationText.some(
    (value) => normalizeCatalogSearchText(value).includes(normalizedQuery)
  );
}

function shouldOfferLocationRequest(searchQuery, searchableLocationText) {
  return (
    normalizeCatalogSearchText(searchQuery).length > 0 &&
    !hasTextualLocationMatch(searchQuery, searchableLocationText)
  );
}

module.exports = {
  CATALOG_REQUEST_COOLDOWN_MS,
  CATALOG_REQUEST_ERROR_MESSAGES,
  CatalogRequestError,
  catalogRequestErrorMessage,
  hasTextualLocationMatch,
  isCatalogRequestCooldownActive,
  shouldOfferLocationRequest,
};
