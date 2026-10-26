# EAS Update

The project is linked to [exponathan/expo-basketball](https://expo.dev/accounts/exponathan/projects/expo-basketball). EAS CLI generated the update URL and appVersion runtime policy through `update:configure`. The SDK-compatible expo-updates module is installed.

## Builds and channels

| Build profile | Channel | EAS environment | Build type |
| --- | --- | --- | --- |
| development | development | development | Simulator development client on iOS, development client on Android |
| preview | preview | preview | Internal distribution |
| production | production | production | Store release |

The remote channels each point to a branch with the same name. A matching branch is an update stream, separate from the Git branch. Updates require a matching platform and runtime version as well as the intended channel.

Existing binaries must be rebuilt once to include the updates module, project link, and update configuration. For local development, use `bun run ios` or `bun run android`. EAS development builds use `bun run eas build --profile development --platform ios` or the Android equivalent. Cloud builds use EAS resources and may require signing setup.

A normal development client previews published updates through its Extensions UI. It does not follow the release app's automatic startup update flow. Preview and production builds embed their EAS channel when built.

## Publish

Sign in to an account with access using `bun run eas login`. Then publish JavaScript and asset changes with a descriptive message:

```sh
bun run update:development --message "Describe the development change"
bun run update:preview --message "Describe the preview change"
```

Each command targets both native platforms and explicitly selects its corresponding EAS environment. EAS CLI is pinned to 25.3.0 in the scripts. Publishing changes remote state. The production command is `bun run update:production --message "Describe the release change"` and should be run deliberately after preview validation.

Use EAS environment variables for values that must be present during cloud builds and update exports. EXPO_PUBLIC values are visible in the bundle. Keep provider credentials on the server. The default sports API is built into the client, so no environment variable is required for that default. Notification delivery still needs a service configured for this application's identifier.

## Compatibility and testing

The current runtime is 1.0.0, derived from the app version. When changing native libraries, config plugins, native settings, or the Expo SDK, bump the Expo app version and create a new native build before publishing for that runtime. Incrementing only the iOS build number or Android version code does not change this runtime policy.

Keep JavaScript and asset updates on the same app version while their native requirements remain compatible. EAS Update cannot add a native module to an already installed binary.

For a release build, fully terminate and reopen the app, allow time to download the update, then terminate and reopen once more if needed. The default configuration downloads in the background and applies a downloaded update on a later cold launch. No startup delay was added.

Setup created the project, channels, and branches. It did not publish an update or request a cloud build. OTA download and activation need a rebuilt client and a published compatible update before they can be tested.

See the official [setup guide](https://docs.expo.dev/eas-update/getting-started/), [runtime-version guide](https://docs.expo.dev/eas-update/runtime-versions/), and [SDK 58 updates reference](https://docs.expo.dev/versions/v58.0.0/sdk/updates/).
