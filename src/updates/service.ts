import * as Updates from 'expo-updates';

export type UpdateChannelResult =
  | { readonly kind: 'reloaded'; readonly channel: string }
  | { readonly kind: 'current'; readonly channel: string }
  | { readonly kind: 'unavailable'; readonly channel: string }
  | { readonly kind: 'error'; readonly channel: string; readonly message: string };

/**
 * Select a PR channel, fetch its compatible update, and restart into it.
 *
 * expo-updates keeps this override on the device. The current channel is read
 * again after a restart, so opening the same QR code after a successful update
 * does not cause a reload loop when no newer update is available.
 */
export async function switchToUpdateChannelAsync(channel: string): Promise<UpdateChannelResult> {
  try {
    if (Updates.channel !== channel) {
      Updates.setUpdateRequestHeadersOverride({ 'expo-channel-name': channel });
    }
    const update = await Updates.checkForUpdateAsync();
    if (!update.isAvailable) {
      return Updates.channel === channel ? { kind: 'current', channel } : { kind: 'unavailable', channel };
    }
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
    return { kind: 'reloaded', channel };
  } catch (error) {
    return { kind: 'error', channel, message: error instanceof Error ? error.message : 'The update could not be loaded.' };
  }
}

/** Clear a PR override so the next update check uses the channel in the build. */
export function clearUpdateChannelOverride(): void {
  Updates.setUpdateRequestHeadersOverride(null);
}
