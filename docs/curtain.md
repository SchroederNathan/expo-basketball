# Game fabric

The game screen owns one persistent curtain behind its list. Refresh and section changes retain its canvas, wind phase, and palette. The team screen keeps its existing backdrop.

The renderer ports [Exact Lob at eab162b2](https://github.com/SchroederNathan/lob/tree/eab162b2395baa2f2ed2c40e8cb8ae7ba55f9517/lob/gpu). `src/screens/game/curtain/provenance.json` records source checksums. The WGSL and Rust texture generator are unchanged. The generated TypeScript packages the shader and all nine RGBA8 texture mips without runtime file access or a Rust toolchain.

Run the checks from the repository root:

```sh
bun run check
bun run check:curtain
bun run check:curtain:gpu
```

`check:curtain` requires `rustc`. To regenerate the packaged assets, run `node scripts/curtain/generate.mjs`. The script refuses source or texture checksum changes.

`check:curtain:gpu` requires Chromium. Install it with `bunx playwright-core install chromium`, or set `CURTAIN_CHROMIUM_PATH` to an existing Chromium executable. It runs the production renderer on browser WebGPU with SwiftShader, reads its pixels, and checks readiness, wind, palette updates, pause/resume, resizing, device loss, and cancellation. It also mounts the real React web surface without `navigator.gpu` to check fallback. This software GPU check does not establish native visual parity.

After `bun run export`, run `bun scripts/curtain/check-export.mjs dist` to verify the exact texture stream in the iOS, Android, and web bundles. The web check also rejects a native surface implementation in the bundle.

Wind counts rendered active time. Palette blending uses wall time and retains unchanged transitions when motion stops. The first completed GPU frame starts the 800 ms reveal. Reduced motion draws a static frame. Focus, app visibility, and the composited visible bottom govern scheduling. The 688-point canvas begins 128 points above the hero content origin. Negative pull offsets cancel the list's overscroll movement, matching the source contract. iOS scroll offsets include the automatic navigation inset once through the header height.

`react-native-webgpu` adds a native module and config plugin. App version 1.0.1 gives it a new `appVersion` runtime and requires a native rebuild. A 1.0.0 client cannot receive this change by OTA. Root owns EAS builds, device validation, iOS inset calibration, and native compositing and color-transfer parity checks.
