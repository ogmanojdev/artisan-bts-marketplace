/**
 * Transcoder — one Cloud Run Job execution per uploaded video.
 *
 *  1. ffprobe hard-validates duration (≤ 15 min; the server is the authority).
 *  2. Encodes the AV1 + H.264 ladders and Opus audio (see ladder.ts).
 *  3. Shaka Packager → CMAF segments + HLS master + DASH manifest.
 *  4. Poster, storyboard sprites and a ~90 s highlight reel.
 *  5. Uploads to the media bucket (behind Cloud CDN) and marks the product READY + published.
 *
 * The raw bucket is mounted read-only at /raw via Cloud Run's GCS volume, so any file size works
 * without copying the original into the job's memory-backed filesystem.
 */
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import pg from "pg";
import { audioArgs, highlightArgs, posterArgs, probe, run, storyboardArgs, videoArgs } from "./ffmpeg.js";
import { AUDIO_LADDER, DURATION_GRACE_SECONDS, MAX_SECONDS, SEGMENT_SECONDS, VIDEO_LADDER, type Rung } from "./ladder.js";

const env = {
  productId: required("PRODUCT_ID"),
  rawObject: required("RAW_OBJECT"),
  rawMount: process.env.RAW_MOUNT ?? "/raw",
  mediaBucket: required("MEDIA_BUCKET"),
  databaseUrl: required("DATABASE_URL"),
  workDir: process.env.WORK_DIR ?? "/tmp/work",
  encodeHighRungs: process.env.ENCODE_HIGH_RUNGS !== "false",
};

const db = new pg.Pool({ connectionString: env.databaseUrl, max: 2 });
const storage = new Storage();

async function main() {
  const input = join(env.rawMount, env.rawObject);
  const version = randomUUID().slice(0, 8);
  const prefix = `${env.productId}/${version}`;
  const src = join(env.workDir, "src");
  const out = join(env.workDir, "out", prefix);
  await mkdir(src, { recursive: true });
  await mkdir(out, { recursive: true });

  const info = await probe(input);
  log("probed", info);
  if (info.durationSeconds > MAX_SECONDS + DURATION_GRACE_SECONDS) {
    return fail(`Video is ${Math.ceil(info.durationSeconds / 60)} min; the limit is 15 min.`);
  }

  // Never upscale: drop rungs taller than the source (keep L0 always).
  const rungs = VIDEO_LADDER.filter((r) => (env.encodeHighRungs || !r.high) && (r.height <= info.height || r.id.endsWith("_l0")));

  // 1) Encode renditions with bounded parallelism (SVT-AV1 is itself multi-threaded).
  const jobs: (() => Promise<unknown>)[] = rungs.map((r) => () => run("ffmpeg", ["-y", "-i", input, ...videoArgs(r), join(src, `${r.id}.mp4`)]));
  if (info.hasAudio) {
    for (const a of AUDIO_LADDER) jobs.push(() => run("ffmpeg", ["-y", "-i", input, ...audioArgs(a), join(src, `${a.id}.mp4`)]));
  }
  jobs.push(() => run("ffmpeg", posterArgs(input, info.durationSeconds, join(out, "poster.webp"))));
  jobs.push(() => run("ffmpeg", storyboardArgs(input, join(out, "storyboard_%03d.webp"))));
  await pool(jobs, Math.max(2, Math.floor(availableParallelism() / 4)));
  log("encoded", { rungs: rungs.map((r) => r.id) });

  // 2) Package full video: HLS (Android/ExoPlayer) + DASH (Shaka on web) from the same CMAF segments.
  await packageRenditions(src, out, rungs, info.hasAudio, { dash: true });

  // 3) Highlight reel: re-encode a ~90 s mezzanine through the low rungs only.
  let highlightPath: string | null = null;
  const hlArgs = highlightArgs(input, info.durationSeconds, info.hasAudio, join(src, "highlight.mp4"));
  if (hlArgs.length) {
    await run("ffmpeg", hlArgs);
    const hlSrc = join(env.workDir, "hl-src");
    const hlOut = join(out, "highlight");
    await mkdir(hlSrc, { recursive: true });
    const hlRungs = VIDEO_LADDER.filter((r) => r.id.endsWith("_l0") || r.id.endsWith("_l1"));
    await pool(
      [
        ...hlRungs.map((r) => () => run("ffmpeg", ["-y", "-i", join(src, "highlight.mp4"), ...videoArgs(r), join(hlSrc, `${r.id}.mp4`)])),
        ...(info.hasAudio ? [() => run("ffmpeg", ["-y", "-i", join(src, "highlight.mp4"), ...audioArgs(AUDIO_LADDER[0]), join(hlSrc, `${AUDIO_LADDER[0].id}.mp4`)])] : []),
      ],
      3,
    );
    await packageRenditions(hlSrc, hlOut, hlRungs, info.hasAudio, { dash: false, audioIds: [AUDIO_LADDER[0].id] });
    highlightPath = `${prefix}/highlight/master.m3u8`;
  }

  // 4) Upload. Segments are immutable (versioned prefix); playlists get a short TTL.
  await uploadDir(join(env.workDir, "out"), env.mediaBucket);

  // 5) Publish.
  await db.query(
    `UPDATE videos SET status = 'READY', duration_seconds = $2, hls_path = $3, dash_path = $4, preview_hls_path = $5,
            highlight_hls_path = $6, poster_path = $7, storyboard_path = $8, error = NULL, updated_at = now()
     WHERE product_id = $1`,
    [
      env.productId,
      info.durationSeconds,
      `${prefix}/master.m3u8`,
      `${prefix}/manifest.mpd`,
      `${prefix}/av1_l0.m3u8`,
      highlightPath,
      `${prefix}/poster.webp`,
      `${prefix}/storyboard_001.webp`,
    ],
  );
  await db.query("UPDATE products SET published = true WHERE id = $1", [env.productId]);
  log("ready", { prefix });
}

async function packageRenditions(
  src: string,
  out: string,
  rungs: Rung[],
  hasAudio: boolean,
  opts: { dash: boolean; audioIds?: string[] },
) {
  await mkdir(out, { recursive: true });
  const streams = rungs.map(
    (r) => `in=${join(src, `${r.id}.mp4`)},stream=video,init_segment=${join(out, r.id, "init.mp4")},segment_template=${join(out, r.id, "$Number$.m4s")},playlist_name=${r.id}.m3u8`,
  );
  if (hasAudio) {
    for (const a of AUDIO_LADDER.filter((x) => !opts.audioIds || opts.audioIds.includes(x.id))) {
      streams.push(
        `in=${join(src, `${a.id}.mp4`)},stream=audio,init_segment=${join(out, a.id, "init.mp4")},segment_template=${join(out, a.id, "$Number$.m4s")},playlist_name=${a.id}.m3u8,hls_group_id=audio,hls_name=${a.id}`,
      );
    }
  }
  await run("packager", [
    ...streams,
    "--segment_duration", String(SEGMENT_SECONDS),
    "--hls_playlist_type", "VOD",
    "--hls_master_playlist_output", join(out, "master.m3u8"),
    ...(opts.dash ? ["--mpd_output", join(out, "manifest.mpd")] : []),
  ]);
}

async function uploadDir(root: string, bucket: string) {
  const files = await walk(root);
  await pool(
    files.map((f) => async () => {
      const name = relative(root, f);
      const isManifest = /\.(m3u8|mpd)$/.test(name);
      await storage.bucket(bucket).upload(f, {
        destination: name,
        resumable: (await stat(f)).size > 8 * 1024 * 1024,
        metadata: {
          cacheControl: isManifest ? "public, max-age=300" : "public, max-age=31536000, immutable",
          contentType: contentType(name),
        },
      });
    }),
    16,
  );
}

function contentType(name: string) {
  if (name.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (name.endsWith(".mpd")) return "application/dash+xml";
  if (name.endsWith(".m4s")) return "video/iso.segment";
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])));
  return nested.flat();
}

async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (i < tasks.length) {
        const idx = i++;
        results[idx] = await tasks[idx]!();
      }
    }),
  );
  return results;
}

async function fail(reason: string) {
  log("failed", { reason });
  await db.query("UPDATE videos SET status = 'FAILED', error = $2, updated_at = now() WHERE product_id = $1", [env.productId, reason]);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function log(message: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity: "INFO", message, productId: env.productId, ...data }));
}

main()
  .catch(async (e) => {
    console.error(JSON.stringify({ severity: "ERROR", message: String(e), productId: env.productId }));
    // Cloud Run Jobs retries the task; only record FAILED on the final attempt.
    const attempt = Number(process.env.CLOUD_RUN_TASK_ATTEMPT ?? 0);
    const maxRetries = Number(process.env.MAX_RETRIES ?? 2);
    if (attempt >= maxRetries) await fail("Processing failed. Please re-upload the video.").catch(() => {});
    process.exitCode = 1;
  })
  .finally(async () => {
    await rm(env.workDir, { recursive: true, force: true }).catch(() => {});
    await db.end();
  });
