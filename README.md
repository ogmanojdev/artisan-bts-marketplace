# Makers BTS: handmade products with behind-the-scenes process videos

Artisans list handmade products alongside a process video of up to 15 minutes. Buyers search, watch how the piece was made, and place an order.

- **Platforms:** Android phone, Android tablet, and Chrome, from one codebase.
- **Network target:** video playback stays smooth below 50 kbps.
- **Hosting:** everything runs on Google Cloud.

```
apps/mobile          Expo (React Native + react-native-web) app — Android phone, Android tablet, Chrome
packages/shared      Zod schemas + types shared by app and API
services/api         Fastify API on Cloud Run (search, listings, uploads, orders, webhooks)
services/transcoder  FFmpeg + Shaka Packager on Cloud Run Jobs (AV1/H.264 ladders, CMAF HLS + DASH)
infra/terraform      All GCP infrastructure (Cloud Run, Cloud SQL, GCS, Pub/Sub, LB + Cloud CDN, Armor)
.github/workflows    CI (typecheck, tests, build, terraform validate) and deploy (WIF → GCP)
```

## How it works

```
App (phone / tablet / Chrome)
  │  HTTPS + HTTP/3
  ▼
Global HTTPS LB ──► api.*   → Cloud Run API ─► Cloud SQL (Postgres FTS)
  (Cloud CDN)   ──► media.* → GCS segments (immutable, edge-cached)
                ──► app.*   → GCS Expo web build

Upload:   App ──resumable chunks──► GCS raw bucket ─finalize─► Pub/Sub ─push─► API ─runJob─► Transcoder
Order:    App ─► API (atomic stock hold) ─► Razorpay ─webhook─► API: PLACED ─► Pub/Sub order-events
```

### Playback below 50 kbps
| Rung | Video | + Opus 12 kbps | Measured on a test clip |
|---|---|---|---|
| `av1_l0` | 256×144 @ 12 fps, 24 kbps | ≈ 36 kbps | 23.5 + 9.5 = **33 kbps** |
| `h264_l0` (non-AV1 devices) | 256×144 @ 10 fps, 36 kbps | ≈ 48 kbps | 37.1 + 9.5 = **47 kbps** |

Higher rungs go up to 720p. The full ladder is in `services/transcoder/src/ladder.ts`.

Player settings:
- Starts on the lowest rung, builds a 60 s buffer, and resumes after 2 s.
- Product cards prefetch the first L0 segments while the buyer scrolls.
- A ~90 s highlight reel and an "audio + stills" mode cover the worst links.

### Uploads of any size
- The API hands the client a GCS resumable-upload session. Video bytes never pass through Cloud Run.
- The client uploads in 8 MiB chunks and resumes after drops or app restarts (sessions live for 7 days).
- Duration is checked on the device first. `ffprobe` re-checks it in the transcoder, and that check is authoritative.

### Orders
- `POST /v1/orders` takes an `Idempotency-Key`. Stock is reserved with a conditional `UPDATE … WHERE stock >= n`, so a one-of-one piece can't be sold twice.
- A signed Razorpay webhook marks the order `PLACED` and publishes `order.placed`. Shipping and fulfilment are out of scope.
- Unpaid holds are released every 5 minutes.

## Run locally

Requires Node 22 and Docker. FFmpeg is only needed to run the transcoder locally.

```bash
npm install
docker compose up -d                            # Postgres 16
cp services/api/.env.example services/api/.env  # DEV_AUTH=true for local tokens
npm --workspace services/api run migrate
npm run api:dev                                 # http://localhost:8080

cd apps/mobile && npx expo install --fix        # align native module versions with the Expo SDK
npm run web                                     # Chrome
npm run android                                 # device/emulator (dev build; react-native-video is native)
```

With `DEV_AUTH=true`, the API accepts `Authorization: Bearer dev:<uid>:<artisan|buyer>`. Sign-in uses Identity Platform (phone OTP + Google); the seam is `apps/mobile/src/auth.ts`.

Note: `react-native-video` and `react-native-razorpay` are native modules. They need an Expo development build (`expo run:android` or EAS Build), not Expo Go.

## Deploy to GCP

1. Create the project, an Artifact Registry repo, and a Workload Identity Federation provider for GitHub Actions. Set the repo variables listed in `.github/workflows/deploy.yml`.
2. Bootstrap order: push the first API and transcoder images, then apply Terraform. Cloud Run needs an image to exist.
   ```bash
   cd infra/terraform
   cp terraform.tfvars.example terraform.tfvars   # fill in
   terraform init
   terraform apply -target=google_project_service.enabled -target=google_artifact_registry_repository.images
   # build + push services/api and services/transcoder images (see deploy.yml), then:
   terraform apply
   ```
3. Add secrets:
   ```bash
   gcloud secrets versions add artisan-razorpay-key-secret --data-file=-
   gcloud secrets versions add artisan-razorpay-webhook-secret --data-file=-
   ```
4. Point the `api`, `media` and `app` DNS records at the `lb_ip` output. Run migrations against Cloud SQL, for example via the Cloud SQL Auth Proxy with `npm --workspace services/api run migrate`.
5. In the Razorpay dashboard, point the webhook (`payment.captured`, `payment.failed`) to `https://<api_domain>/v1/webhooks/razorpay`.

After that, every push to `main` builds and deploys the API, the transcoder job, and the web app.

## Status and next steps
See [`docs/roadmap.md`](docs/roadmap.md).
