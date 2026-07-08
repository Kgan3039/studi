export const STUDI_APP_NAME = 'Studi';

const STUDI_WEB_BASE_URL = 'https://www.joinstudi.com';
const STUDI_DEFAULT_SUPPORT_EMAIL = 'isp.studi@gmail.com';

const configuredWebBaseUrl = process.env.EXPO_PUBLIC_STUDI_WEB_BASE_URL?.replace(/\/$/, '');

function buildStudiWebUrl(path: `/${string}`) {
  if (configuredWebBaseUrl) {
    return `${configuredWebBaseUrl}${path}`;
  }

  if (process.env.EXPO_OS === 'web') {
    return path;
  }

  return `${STUDI_WEB_BASE_URL}${path}`;
}

export const STUDI_PRIVACY_POLICY_URL =
  process.env.EXPO_PUBLIC_STUDI_PRIVACY_POLICY_URL ?? buildStudiWebUrl('/privacy');

export const STUDI_SUPPORT_URL =
  process.env.EXPO_PUBLIC_STUDI_SUPPORT_URL ?? buildStudiWebUrl('/support');

export const STUDI_SUPPORT_EMAIL =
  process.env.EXPO_PUBLIC_STUDI_SUPPORT_EMAIL ?? STUDI_DEFAULT_SUPPORT_EMAIL;

export const STUDI_CONTACT_EMAIL =
  process.env.EXPO_PUBLIC_STUDI_CONTACT_EMAIL ?? STUDI_SUPPORT_EMAIL;
