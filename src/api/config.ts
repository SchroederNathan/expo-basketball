const DEFAULT_API_URL = 'https://lob-api.expo.app/api';
const BASE_URL_PATTERN = /^https?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/;

function baseUrl(raw: string | undefined): string {
  const value = raw?.trim() ?? '';
  return BASE_URL_PATTERN.test(value) ? value.replace(/\/+$/, '') : DEFAULT_API_URL;
}

export const API_BASE_URL = baseUrl(process.env.EXPO_PUBLIC_API_URL);
