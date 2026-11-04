/**
 * Channels created by the PR preview workflow. Keeping the grammar narrow
 * prevents an arbitrary deep link from selecting a channel the tester was not
 * invited to try.
 */
const PR_CHANNEL = /^pr-[1-9][0-9]{0,8}$/;

export function parseUpdateChannel(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
  return candidate && PR_CHANNEL.test(candidate) ? candidate : null;
}

export function updateDeepLink(channel: string): string {
  if (!PR_CHANNEL.test(channel)) throw new Error('Invalid PR update channel.');
  return `basketball://update?channel=${encodeURIComponent(channel)}`;
}

export function updateQrImageUrl(channel: string, size = 320): string {
  if (!Number.isInteger(size) || size < 120 || size > 1000) throw new Error('QR size must be an integer between 120 and 1000.');
  return `https://quickchart.io/qr?size=${size}&text=${encodeURIComponent(updateDeepLink(channel))}`;
}
