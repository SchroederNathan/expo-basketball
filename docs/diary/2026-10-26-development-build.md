# Development build setup

The app uses `expo-dev-client` for local testing. Its bundle identifier is `dev.expo.basketball`, and its URL scheme is `basketball`. Native projects come from Expo prebuild and stay out of source control. App config and config plugins remain the source of truth.

The iOS development profile in `eas.json` targets a simulator. Local `bun run ios` builds through Xcode. `bun start` starts Metro in development-client mode. No hosted build or deployment is required for local development. The later [Bun migration](2026-10-26-bun.md) records the package-manager change.

Expo UI, Router, notifications, SecureStore, SVG, Reanimated, and Gesture Handler are installed through Expo's package resolver. The app uses the package versions selected for SDK 58.

The initial install reported advisories in Expo CLI's transitive dependencies. A nonbreaking `npm audit fix` did not resolve every advisory. The remaining report includes `node-forge` signature validation and a nested Zod version used by the CLI. The package manager proposes an older Expo major as a forced fix. That downgrade was rejected because it would change the SDK and native dependencies. Recheck these advisories when Expo publishes dependency updates.

A simulator can verify screen behavior and navigation. It cannot establish physical push delivery or motion performance on a release device.
