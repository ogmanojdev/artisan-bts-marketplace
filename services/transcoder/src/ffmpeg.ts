import { spawn } from "node:child_process";
import { AUDIO_LADDER, HIGHLIGHT_CLIPS, HIGHLIGHT_SECONDS, SEGMENT_SECONDS, type Rung } from "./ladder.js";

export function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-8000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err}`))));
  });
}

export type Probe = { durationSeconds: number; hasAudio: boolean; width: number; height: number };

export async function probe(input: string): Promise<Probe> {
  const json = JSON.parse(
    await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", input]),
  ) as { format: { duration?: string }; streams: { codec_type: string; width?: number; height?: number }[] };
  const v = json.streams.find((s) => s.codec_type === "video");
  if (!v) throw new Error("No video stream found");
  return {
    durationSeconds: Number(json.format.duration ?? 0),
    hasAudio: json.streams.some((s) => s.codec_type === "audio"),
    width: v.width ?? 0,
    height: v.height ?? 0,
  };
}

/** Video-only args for one rung. Fixed 2 s GOPs with no scene-cut keyframes keep segments aligned across rungs. */
export function videoArgs(r: Rung): string[] {
  const gop = String(r.fps * SEGMENT_SECONDS);
  const scale = `scale=w=${r.width}:h=${r.height}:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=${r.fps}`;
  const common = ["-vf", scale, "-an", "-pix_fmt", "yuv420p", "-g", gop, "-keyint_min", gop];
  if (r.codec === "av1") {
    return [
      ...common,
      "-c:v", "libsvtav1",
      "-preset", r.kbps <= 60 ? "6" : "8", // spend more effort where every bit counts
      "-b:v", `${r.kbps}k`,
      "-svtav1-params", `rc=1:tune=0:scd=0:keyint=${gop}:fast-decode=1`,
    ];
  }
  return [
    ...common,
    "-c:v", "libx264",
    "-preset", "slow",
    "-profile:v", r.height <= 240 ? "baseline" : "main",
    "-b:v", `${r.kbps}k`,
    "-maxrate", `${Math.round(r.kbps * 1.15)}k`,
    "-bufsize", `${r.kbps * 2}k`,
    "-x264-params", `scenecut=0:open-gop=0`,
  ];
}

export function audioArgs(a: (typeof AUDIO_LADDER)[number]): string[] {
  return ["-vn", "-c:a", "libopus", "-b:a", `${a.kbps}k`, "-ac", String(a.channels), "-application", "audio", "-frame_duration", "60"];
}

/** Poster: one small WebP around 10% into the video (skips black intro frames). */
export function posterArgs(input: string, duration: number, out: string): string[] {
  return ["-y", "-ss", String(Math.max(1, duration * 0.1)), "-i", input, "-frames:v", "1", "-vf", "scale=480:-2", "-c:v", "libwebp", "-quality", "55", out];
}

/** Storyboard: one 160px thumb every 5 s, tiled 10x10 per sprite. Used for scrubbing and survival mode. */
export function storyboardArgs(input: string, out: string): string[] {
  return ["-y", "-i", input, "-an", "-vf", "fps=1/5,scale=160:-2,tile=10x10", "-c:v", "libwebp", "-quality", "50", out];
}

/** Highlight reel: N evenly spaced clips concatenated into ~90 s. */
export function highlightArgs(input: string, duration: number, hasAudio: boolean, out: string): string[] {
  const clipLen = HIGHLIGHT_SECONDS / HIGHLIGHT_CLIPS;
  if (duration <= HIGHLIGHT_SECONDS * 1.5) return [];
  const starts = Array.from({ length: HIGHLIGHT_CLIPS }, (_, i) => ((duration - clipLen) * (i + 0.5)) / HIGHLIGHT_CLIPS);
  const parts: string[] = [];
  const labels: string[] = [];
  starts.forEach((s, i) => {
    parts.push(`[0:v]trim=start=${s.toFixed(2)}:duration=${clipLen},setpts=PTS-STARTPTS[v${i}]`);
    if (hasAudio) parts.push(`[0:a]atrim=start=${s.toFixed(2)}:duration=${clipLen},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(hasAudio ? `[v${i}][a${i}]` : `[v${i}]`);
  });
  const concat = `${labels.join("")}concat=n=${HIGHLIGHT_CLIPS}:v=1:a=${hasAudio ? 1 : 0}[v]${hasAudio ? "[a]" : ""}`;
  return [
    "-y", "-i", input,
    "-filter_complex", [...parts, concat].join(";"),
    "-map", "[v]", ...(hasAudio ? ["-map", "[a]"] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "128k",
    out,
  ];
}
