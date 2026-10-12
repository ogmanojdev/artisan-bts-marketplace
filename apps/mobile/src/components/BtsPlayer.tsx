/**
 * Android (phone + tablet) process-video player.
 * react-native-video v6 → Media3 ExoPlayer: CMAF HLS, ABR, AV1 (Android 10+ software decoder)
 * with automatic fallback to the H.264 "lite" ladder on devices that can't decode AV1.
 *
 * Web uses BtsPlayer.web.tsx (Shaka Player) — Metro picks the file by platform extension.
 */
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import Video, { SelectedVideoTrackType, type OnBandwidthUpdateData } from "react-native-video";
import { config } from "@/config";

export type BtsPlayerProps = {
  hlsUrl: string;
  dashUrl?: string | null;
  posterUrl?: string | null;
  title: string;
  /** Survival mode: audio + storyboard only, for links below ~20 kbps. */
  audioOnly?: boolean;
};

export function BtsPlayer({ hlsUrl, posterUrl, title, audioOnly }: BtsPlayerProps) {
  const [buffering, setBuffering] = useState(true);
  const [kbps, setKbps] = useState<number | null>(null);

  return (
    <View style={styles.frame} accessibilityLabel={`Process video: ${title}`}>
      <Video
        style={StyleSheet.absoluteFill}
        source={{
          uri: hlsUrl,
          type: "m3u8",
          bufferConfig: {
            minBufferMs: config.player.minBufferMs,
            maxBufferMs: config.player.maxBufferMs,
            bufferForPlaybackMs: config.player.bufferForPlaybackMs,
            bufferForPlaybackAfterRebufferMs: config.player.bufferForPlaybackAfterRebufferMs,
            cacheSizeMB: 64,
          },
        }}
        controls
        resizeMode="contain"
        // Survival mode: drop the video track entirely, keep narration flowing.
        selectedVideoTrack={{ type: audioOnly ? SelectedVideoTrackType.DISABLED : SelectedVideoTrackType.AUTO }}
        reportBandwidth
        onBandwidthUpdate={(e: OnBandwidthUpdateData) => setKbps(Math.round(e.bitrate / 1000))}
        onBuffer={({ isBuffering }) => setBuffering(isBuffering)}
        onLoad={() => setBuffering(false)}
        playInBackground={false}
        ignoreSilentSwitch="ignore"
      />
      {buffering && (
        <View style={styles.overlay} pointerEvents="none">
          {posterUrl ? <Image source={posterUrl} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          <ActivityIndicator color="#fff" />
        </View>
      )}
      {kbps !== null && (
        <Text style={styles.badge} accessibilityElementsHidden>
          {kbps} kbps
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#111", borderRadius: 12, overflow: "hidden" },
  overlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    color: "#fff",
    fontSize: 11,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
