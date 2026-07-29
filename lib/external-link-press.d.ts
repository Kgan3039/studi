export declare const LINK_FAILED_TITLE: string;
export declare const LINK_FAILED_BODY: string;

export declare function isHttpUrl(href: string): boolean;

/**
 * - `web-default` — running on web; the anchor's own navigation was left alone
 * - `opened` — the browser or the OS handler accepted the href
 * - `unavailable` — mailto: with no email app installed
 * - `failed` — an open or capability check threw; the user was told
 */
export type ExternalLinkPressStatus = 'web-default' | 'opened' | 'unavailable' | 'failed';

export type ExternalLinkPressResult = {
  status: ExternalLinkPressStatus;
  href: string;
};

export declare function handleExternalLinkPress(input: {
  href: string;
  /** process.env.EXPO_OS === 'web' at the call site. */
  isWeb: boolean;
  preventDefault: () => void;
  canOpenURL: (url: string) => Promise<boolean> | boolean;
  openURL: (url: string) => Promise<unknown> | unknown;
  openBrowser: (url: string) => Promise<unknown> | unknown;
  alert: (title: string, message: string) => void;
}): Promise<ExternalLinkPressResult>;
