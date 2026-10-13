/**
 * Chrome process-video player using Shaka Player (MSE).
 * Prefers AV1 + Opus, starts from a 40 kbps bandwidth estimate (lowest rung), builds a
 * 60 s buffer and resumes after 2 s — tuned for sub-50 kbps links.
 */
import { useEffect, useRef, useState } from "react";
import type { BtsPlayerProps } from "./BtsPlayer";

export type { BtsPlayerProps };

export function BtsPlayer({ hlsUrl, dashUrl, posterUrl, title, audioOnly }: BtsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [kbps, setKbps] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let player: any = null;

    (async () => {
      // Lazy-loaded: keeps Shaka (~260 KB gz) out of the first page load and out of static
      // pre-rendering, which runs in Node where browser globals don't exist.
      // @ts-ignore - shaka ships Closure externs, not TS types, for the compiled build
      const { default: shaka } = await import("shaka-player/dist/shaka-player.compiled");
      if (cancelled) return;
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        setError("This browser can't play adaptive video.");
        return;
      }

      player = new shaka.Player();

      // Shaka's defaults give up on a request whose headers take over 10 s and try the manifest
      // only twice; at 50 kbps a 20 KB manifest behind a TLS handshake can exceed that.
      const patientRetries = { maxAttempts: 8, baseDelay: 500, backoffFactor: 2, fuzzFactor: 0.5, timeout: 60_000, connectionTimeout: 30_000, stallTimeout: 30_000 };

      player.configure({
        manifest: { retryParameters: patientRetries },
        abr: {
          enabled: true,
          // Otherwise Shaka seeds its estimate from navigator.connection.downlink, which reports
          // the device's last good link (e.g. 1.5 Mbps) and starts a slow connection on 720p.
          useNetworkInformation: false,
          defaultBandwidthEstimate: 40_000,
          switchInterval: 4,
          bandwidthUpgradeTarget: 0.7,
          bandwidthDowngradeTarget: 0.95,
        },
        streaming: {
          bufferingGoal: 60,
          rebufferingGoal: 2,
          bufferBehind: 10,
          retryParameters: patientRetries,
        },
        preferredVideoCodecs: ["av01", "avc1"],
        preferredAudioCodecs: ["opus", "mp4a"],
      });

      const onAdapt = () => {
        const stats = player.getStats();
        if (Number.isFinite(stats.estimatedBandwidth)) setKbps(Math.round(stats.estimatedBandwidth / 1000));
      };
      player.addEventListener("adaptation", onAdapt);
      player.addEventListener("variantchanged", onAdapt);

      await player.attach(video);
      if (cancelled) return;
      try {
        // DASH is Shaka's native format; HLS works too.
        await player.load(dashUrl ?? hlsUrl);
        if (audioOnly) {
          const audio = player.getVariantTracks().filter((t: { videoCodec: string | null }) => !t.videoCodec);
          if (audio[0]) player.selectVariantTrack(audio[0], true);
        }
      } catch (e) {
        if (!cancelled) setError("Couldn't load the video. Retrying when the network recovers.");
        console.error(e);
      }
    })();

    return () => {
      cancelled = true;
      player?.destroy();
    };
  }, [hlsUrl, dashUrl, audioOnly]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        background: "#111",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <video
        ref={videoRef}
        aria-label={`Process video: ${title}`}
        poster={posterUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
        style={{ width: "100%", height: "100%" }}
      />
      {kbps !== null && (
        <span
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            color: "#fff",
            fontSize: 11,
            background: "rgba(0,0,0,.5)",
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {kbps} kbps
        </span>
      )}
      {error && <span style={{ position: "absolute", bottom: 8, left: 8, right: 8, color: "#fff", fontSize: 13 }}>{error}</span>}
    </div>
  );
}
