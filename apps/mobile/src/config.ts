import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

export const config = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? extra.apiBaseUrl ?? "http://localhost:8080",
  razorpayKeyId: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? extra.razorpayKeyId ?? "",
  /** 8 MiB: GCS resumable chunks must be multiples of 256 KiB. */
  uploadChunkBytes: 8 * 1024 * 1024,
  /** Playback buffer tuned for <50 kbps links: build a deep buffer, resume early. */
  player: {
    minBufferMs: 10_000,
    maxBufferMs: 60_000,
    bufferForPlaybackMs: 2_000,
    bufferForPlaybackAfterRebufferMs: 10_000,
    /** Start on the lowest rung; ABR climbs only once throughput is proven. */
    initialBitrateKbps: 36,
  },
};
