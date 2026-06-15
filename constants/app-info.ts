export const STUDI_APP_NAME = 'Studi';

const STUDI_FIREBASE_HOSTING_URL = 'https://studi-b02c3.web.app';
const STUDI_LOCAL_SUPPORT_EMAIL = 'support@studi.local';

const configuredWebBaseUrl = process.env.EXPO_PUBLIC_STUDI_WEB_BASE_URL?.replace(/\/$/, '');

function buildStudiWebUrl(path: `/${string}`) {
  if (configuredWebBaseUrl) {
    return `${configuredWebBaseUrl}${path}`;
  }

  if (process.env.EXPO_OS === 'web') {
    return path;
  }

  return `${STUDI_FIREBASE_HOSTING_URL}${path}`;
}

export const STUDI_PRIVACY_POLICY_URL =
  process.env.EXPO_PUBLIC_STUDI_PRIVACY_POLICY_URL ?? buildStudiWebUrl('/privacy');

export const STUDI_SUPPORT_URL =
  process.env.EXPO_PUBLIC_STUDI_SUPPORT_URL ?? buildStudiWebUrl('/support');

export const STUDI_SUPPORT_EMAIL =
  process.env.EXPO_PUBLIC_STUDI_SUPPORT_EMAIL ?? STUDI_LOCAL_SUPPORT_EMAIL;

export const STUDI_CONTACT_EMAIL =
  process.env.EXPO_PUBLIC_STUDI_CONTACT_EMAIL ?? STUDI_SUPPORT_EMAIL;
