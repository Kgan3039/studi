export declare const CONTACT_EMAIL_SUBJECT: string;
export declare const CONTACT_UNAVAILABLE_TITLE: string;
export declare const CONTACT_FAILED_TITLE: string;

export declare function buildContactMailtoUrl(email: string, subject: string): string;

export declare function isMailtoUrl(url: string): boolean;

/** The recipient read back out of a mailto: href; '' if it cannot be parsed. */
export declare function contactAddressFromMailtoUrl(url: string): string;

export declare function unavailableMessage(email: string): string;
export declare function failedMessage(email: string): string;

/**
 * - `opened` — openURL() resolved
 * - `unavailable` — an available canOpenURL() answered false; openURL() never ran
 * - `failed` — canOpenURL() or openURL() threw
 */
export type ContactEmailStatus = 'opened' | 'unavailable' | 'failed';

export type ContactEmailResult = {
  status: ContactEmailStatus;
  /** The mailto: URL handled by the operation, for logging and assertions. */
  url: string;
};

/**
 * Either a complete href (preserved verbatim), or the fields to build one.
 * `email` may accompany `url` to override the address named in the fallback
 * copy; by default that address is read out of the URL.
 */
export type ContactEmailTarget =
  | { url: string; email?: string; subject?: never }
  | { url?: never; email: string; subject?: string };

export type ContactEmailPorts = {
  /** Omitted on Android, where package visibility can make the check unreliable. */
  canOpenURL?: (url: string) => Promise<boolean> | boolean;
  openURL: (url: string) => Promise<unknown> | unknown;
  alert: (title: string, message: string) => void;
};

export declare function openContactEmail(
  input: ContactEmailTarget & ContactEmailPorts
): Promise<ContactEmailResult>;
