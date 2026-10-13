/**
 * Local stand-in for the GCP media path:  npm run local:media
 *
 *   GCS bucket + OBJECT_FINALIZE → Pub/Sub → API → Cloud Run Job
 * becomes
 *   fake-gcs-server (docker compose) + this proxy → `docker compose run transcoder`
 *
 * The app and the API talk to this proxy on :4443; it forwards to fake-gcs-server on :4444 and
 * fills two gaps in the emulator that the real GCS doesn't have:
 *   - it answers resumable-upload status queries (`Content-Range: bytes * /N`), which the
 *     emulator would treat as the end of the upload;
 *   - it exposes the `Range` response header to browsers (the raw bucket's CORS config on GCP).
 * When an upload under raw/<productId>/ completes, it runs the transcoder container for it.
 */
import { spawn } from "node:child_process";
import http from "node:http";

const PORT = Number(process.env.LOCAL_MEDIA_PORT ?? 4443);
const EMULATOR = { host: "127.0.0.1", port: Number(process.env.GCS_EMULATOR_PORT ?? 4444) };
const BUCKETS = ["artisan-raw", "artisan-media"];
const EXPOSED = "Range, Location, Content-Range, Content-Length, Content-Type";

/** upload_id → bytes the emulator has acknowledged so far. */
const received = new Map();
const queue = [];
let transcoding = false;

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://local");
    const uploadId = req.method === "PUT" ? url.searchParams.get("upload_id") : null;

    if (uploadId && /^bytes \*\//.test(req.headers["content-range"] ?? "")) {
      const bytes = received.get(uploadId) ?? 0;
      res.writeHead(308, { ...cors(req), ...(bytes ? { Range: `bytes=0-${bytes - 1}` } : {}) });
      return res.end();
    }

    const upstream = http.request({ ...EMULATOR, method: req.method, path: req.url, headers: req.headers }, (up) => {
      if (uploadId) {
        const acked = up.headers.range?.match(/bytes=0-(\d+)/);
        if (up.statusCode === 308 && acked) received.set(uploadId, Number(acked[1]) + 1);
        if (up.statusCode === 200 || up.statusCode === 201) {
          received.delete(uploadId);
          finalized(url.searchParams.get("name") ?? "");
        }
      }
      res.writeHead(up.statusCode ?? 502, { ...up.headers, ...cors(req) });
      up.pipe(res);
    });
    upstream.on("error", (e) => {
      console.error(`[media] emulator unreachable (${e.message}); is "docker compose up -d" running?`);
      res.writeHead(502, cors(req)).end();
    });
    req.pipe(upstream);
  })
  .listen(PORT, async () => {
    await ensureBuckets();
    console.log(`[media] local GCS on http://localhost:${PORT} (emulator :${EMULATOR.port}); waiting for uploads`);
  });

function cors(req) {
  // Lower-case keys so these replace the emulator's own headers instead of duplicating them.
  return { "access-control-allow-origin": req.headers.origin ?? "*", "access-control-expose-headers": EXPOSED };
}

function finalized(objectName) {
  const productId = objectName.match(/^raw\/([0-9a-f-]{36})\//)?.[1];
  if (!productId) return;
  console.log(`[media] upload complete: ${objectName}`);
  queue.push({ productId, objectName });
  void drain();
}

/** One encode at a time: SVT-AV1 already uses every core. */
async function drain() {
  if (transcoding) return;
  transcoding = true;
  for (let job; (job = queue.shift()); ) {
    console.log(`[media] transcoding ${job.productId} …`);
    const started = Date.now();
    const code = await new Promise((resolve) =>
      spawn(
        "docker",
        ["compose", "--profile", "jobs", "run", "--rm", "-e", `PRODUCT_ID=${job.productId}`, "-e", `RAW_OBJECT=${job.objectName}`, "transcoder"],
        { stdio: "inherit" },
      ).on("close", resolve),
    );
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(code === 0 ? `[media] ${job.productId} is READY (${secs}s)` : `[media] transcoder failed for ${job.productId} (exit ${code})`);
  }
  transcoding = false;
}

async function ensureBuckets() {
  for (const name of BUCKETS) {
    const res = await fetch(`http://${EMULATOR.host}:${EMULATOR.port}/storage/v1/b?project=local-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (!res) return console.error(`[media] emulator not reachable on :${EMULATOR.port}; run "docker compose up -d" first`);
  }
}
