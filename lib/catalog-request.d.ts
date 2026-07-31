export type CatalogRequestDomainErrorCode =
  | 'catalog-request/cooldown'
  | 'catalog-request/invalid';

export declare const CATALOG_REQUEST_COOLDOWN_MS: number;

export declare const CATALOG_REQUEST_ERROR_MESSAGES: {
  cooldown: string;
  auth: string;
  invalid: string;
  network: string;
  generic: string;
};

export declare class CatalogRequestError extends Error {
  code: CatalogRequestDomainErrorCode;
  constructor(code: CatalogRequestDomainErrorCode);
}

export declare function catalogRequestErrorMessage(error: unknown): string;

export declare function isCatalogRequestCooldownActive(
  updatedAtMillis: number,
  nowMillis?: number
): boolean;

export declare function hasTextualLocationMatch(
  searchQuery: string,
  searchableLocationText: unknown
): boolean;

export declare function shouldOfferLocationRequest(
  searchQuery: string,
  searchableLocationText: unknown
): boolean;
