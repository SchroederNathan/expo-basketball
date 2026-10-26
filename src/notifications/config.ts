// No default service exists. A build enables notifications only when this
// public URL names a service configured for the app's own bundle identifier.
const SERVICE_URL_PATTERN = /^https:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/;

export function parseServiceUrl(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  return SERVICE_URL_PATTERN.test(value) ? value.replace(/\/+$/, '') : null;
}

export const NOTIFICATION_SERVICE_URL = parseServiceUrl(process.env.EXPO_PUBLIC_NOTIFICATION_API_URL);
