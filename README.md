<img src="assets/icon.png" width="64" height="64" alt="Lob basketball icon">

# Expo Basketball

A basketball scores app built with Expo, Expo Router, and Expo UI. It uses the existing [basketball API](docs/api.md) for NBA, WNBA, and college basketball data.

## Run a development build

Use Node 22 or newer. iOS builds require Xcode and CocoaPods. Android builds require Android Studio and a configured emulator or device.

```sh
npm install
npm run ios
```

For Android, run `npm run android`. To reconnect an installed development build, run `npm start`. The app has its own application identifier, `dev.expo.basketball`.

The default API needs no credentials. Copy `.env.example` to `.env.local` only when changing the API URL or configuring a notification service. `EXPO_PUBLIC_*` values are visible in the app bundle. Keep provider credentials on your server.

## Project layout

`src/app` contains Expo Router routes. `src/screens` contains screen bodies. Shared UI lives in `src/components`. The theme owns repeated visual values. Data validation and requests live outside route files.

Read the [implementation plan](docs/port-plan.md), [API reference](docs/api.md), [development diaries](docs/diary/README.md), and [decision trail](docs/decisions.tsv).

## Check the app

```sh
npm run check
npm run check:api
npm run export
npx expo-doctor
```

`check` runs TypeScript, behavior tests, and public-file checks. `check:api` validates responses from the deployed service. Read the [verification record](docs/verification.md) for native checks and remaining device requirements.

## Data and artwork

Basketball data and remote team and player images come from third-party services. Their availability does not grant ownership of league or team marks. This repository does not contain sports data snapshots or provider credentials.
