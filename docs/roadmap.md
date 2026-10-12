# Roadmap and known gaps

## Verified in this scaffold
These checks ran locally on Postgres 16 and FFmpeg:
- Backend typechecks, the unit tests pass, and both services bundle.
- The migration applies cleanly.
- Search:
  - keyword, tag and price filters
  - typo tolerance via trigram similarity
  - pagination
- Orders:
  - one-of-one items can't be double-sold (second buyer gets 409)
  - idempotent retries return the original order
  - unpaid holds expire and stock is released
- Encodes and assets:
  - L0 bitrates: AV1 video 23.5 kbps, H.264 lite 37.1 kbps, Opus 9.5 kbps
  - poster ~5 KB
  - the highlight reel comes out at exactly 90 s
- App:
  - typechecks against Expo SDK 57 / React Native 0.86.3, with versions taken from Expo's own version map
  - the Chrome production build succeeds, and every route pre-renders to static HTML
  - web bundle: 418 KB gzipped entry; Shaka is a separate 262 KB chunk, loaded only when a video opens

## Not yet verified
- Terraform validate/plan; CI runs `terraform validate`.
- The Shaka Packager step. The Docker build checks the binary exists, but packaging hasn't been run here.
- On-device Android playback and the Android release build.

## Next
1. **Auth UI:** wire Identity Platform phone OTP and Google sign-in into `apps/mobile/src/auth.ts`, and set the `role` custom claim when an artisan onboards.
2. **Android background upload:** move chunk uploads into a WorkManager-backed native module (or `expo-background-task`) so they keep going with the app closed.
3. **On-device pre-compression:** an optional 720p re-encode with Media3 Transformer before upload, which cuts upload size roughly 10×.
4. **True prefetch on Android:** use Media3 `PreloadManager` through a small native module. Today the JS prefetch only warms the CDN and HTTP cache.
5. **Offline save:** let buyers save the L0 rendition (about 4 MB for 15 minutes) with Media3 `DownloadManager`.
6. **Lazy high rungs:** set `ENCODE_HIGH_RUNGS=false` and encode 480p+ only for videos that get traffic.
7. **QoE telemetry:** send startup time, rebuffer ratio and selected rung from both players to BigQuery, and tune the ladder from that data.
8. **Search scale:** move to Vertex AI Search once listings or multilingual relevance outgrow Postgres FTS.
9. **Web first load (the weakest point at 50 kbps):** the 418 KB entry takes about a minute on a 50 kbps link.
   - Turn on Expo Router async routes so each screen loads on demand.
   - Swap Zod for a lighter validator on the client.
   - Add a service worker so repeat visits are instant.
   - Target: under 150 KB for the first screen.
