# Verification record

This document separates checks run during development from checks that still need a suitable device or service.

## Setup checks

- `npx expo-doctor` passed all 20 checks after SDK 58 installation and native prebuild.
- `npm run check:public` passed for the initial public documentation and configuration.
- Read-only requests to scoreboards, teams, standings, player leaders, and search returned HTTP 200 from the default API.

## Required client checks

The implementation must pass TypeScript checking, focused calendar and request tests, API response validation, and iOS, Android, and web bundle exports. The development build must be exercised for scores, game details, teams, standings, players, and search.

A screen must show an initial loading state, a useful empty state after a successful empty response, and a retry action after a failed first request. Failed refreshes must leave the last successful content readable.

## Checks that need separate evidence

Push delivery requires a physical device and a notification service configured for this app identifier. Release motion performance needs a release build on the slowest supported device. Android simulator interaction needs an available emulator. None of these follows from a successful JavaScript bundle export.
