/**
 * Measure duration before uploading so artisans don't push a 2 GB file only to be rejected.
 * The transcoder re-checks with ffprobe; the server is the authority.
 */
import { createVideoPlayer } from "expo-video";

export async function measureDurationSeconds(asset: { uri: string }): Promise<number> {
  const player = createVideoPlayer(asset.uri);
  try {
    for (let i = 0; i < 50 && !(player.duration > 0); i++) await new Promise((r) => setTimeout(r, 100));
    return player.duration;
  } finally {
    player.release();
  }
}
