# EAS Update setup

The repository had no EAS project link and no updates module. The signed-in Expo account owns the new project. EAS CLI created and linked expo-basketball, uploaded the navy project icon, and generated the update URL and appVersion runtime policy. The public project identifier is required configuration, not a credential.

Expo installed the SDK-compatible expo-updates package through Bun. The configuration command preserved the existing build profiles and assigned matching channels. Each profile now selects its matching EAS environment explicitly. Publish scripts pin EAS CLI 25.3.0, select an environment, and target both native platforms.

The first invocation through the latest-version CLI cache failed to load one of the CLI's own modules. Running the supported command with the explicit 25.3.0 package completed successfully. No configuration fields were reconstructed by hand to bypass the failed command.

Native config introspection confirmed the update URL and runtime 1.0.0 in the generated iOS and Android settings. The current runtime policy means native changes require an app-version bump and a new binary. The default launch behavior keeps startup responsive while updates download in the background.

No update was published and no cloud build was started during setup. Existing development clients need a rebuild. The [EAS Update guide](../eas-update.md) records build, publication, compatibility, and QA steps.
