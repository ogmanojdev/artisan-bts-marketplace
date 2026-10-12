/**
 * Encoding ladder. L0 is the rung that must survive a sub-50 kbps link:
 *   24 kbps AV1 video + 12 kbps Opus audio ≈ 38 kbps with container overhead.
 * The H.264 "lite" ladder exists for devices without AV1 decode (pre-Android 10, old Chromes);
 * players drop codecs they can't decode, so both ladders live in one master playlist.
 *
 * Bitrates are design targets; tune them against real QoE data (rebuffer ratio, startup time).
 */
export type Rung = {
  id: string;
  codec: "av1" | "h264";
  width: number;
  height: number;
  fps: number;
  kbps: number;
  /** Skip when ENCODE_HIGH_RUNGS=false (encode lazily for videos that get traffic). */
  high?: boolean;
};

export const VIDEO_LADDER: Rung[] = [
  { id: "av1_l0", codec: "av1", width: 256, height: 144, fps: 12, kbps: 24 },
  { id: "av1_l1", codec: "av1", width: 426, height: 240, fps: 15, kbps: 60 },
  { id: "av1_l2", codec: "av1", width: 640, height: 360, fps: 24, kbps: 134 },
  { id: "av1_l3", codec: "av1", width: 854, height: 480, fps: 24, kbps: 280, high: true },
  { id: "av1_l4", codec: "av1", width: 1280, height: 720, fps: 30, kbps: 768, high: true },
  { id: "h264_l0", codec: "h264", width: 256, height: 144, fps: 10, kbps: 36 },
  { id: "h264_l1", codec: "h264", width: 426, height: 240, fps: 15, kbps: 90 },
  { id: "h264_l2", codec: "h264", width: 640, height: 360, fps: 24, kbps: 250 },
  { id: "h264_l4", codec: "h264", width: 1280, height: 720, fps: 30, kbps: 1200, high: true },
];

/**
 * Audio: speech-heavy narration stays intelligible with Opus at 12 kbps mono.
 * HLS uses the 12 kbps track as DEFAULT (HLS can't switch audio by bandwidth); DASH/Shaka on
 * web adapts between both.
 */
export const AUDIO_LADDER = [
  { id: "opus_low", kbps: 12, channels: 1 },
  { id: "opus_high", kbps: 48, channels: 2 },
] as const;

export const SEGMENT_SECONDS = 2;
export const MAX_SECONDS = 15 * 60;
/** Allow a little slack for container/timestamp rounding. */
export const DURATION_GRACE_SECONDS = 2;
export const HIGHLIGHT_SECONDS = 90;
export const HIGHLIGHT_CLIPS = 10;
