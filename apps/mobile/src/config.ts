import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

export const config = {
  // `||`, not `??`: an unset CI variable arrives as "", which must fall through to app.json too.
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || extra.apiBaseUrl || "http://localhost:8080",
  razorpayKeyId: process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID || extra.razorpayKeyId || "",
  /** Pairs with the API's DEV_AUTH=true: requests carry a fixed demo-user token instead of a sign-in. */
  devAuth: process.env.EXPO_PUBLIC_DEV_AUTH === "true",
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
