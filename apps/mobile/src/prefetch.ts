/**
 * Warm the first few lowest-rung segments when a product card scrolls into view, so tapping
 * play starts almost instantly on slow links (~25 KB for 3 L0 segments).
 *
 * Web: segments land in the browser HTTP cache, which Shaka reuses.
 * Android: this warms the CDN edge and OkHttp cache; true player-level preloading would use
 * Media3's PreloadManager through a small native module (tracked in docs/roadmap.md).
 */
const warmed = new Set<string>();

export async function prefetchPreview(previewHlsUrl: string | null, segments = 3): Promise<void> {
  if (!previewHlsUrl || warmed.has(previewHlsUrl)) return;
  warmed.add(previewHlsUrl);
  try {
    const playlist = await (await fetch(previewHlsUrl)).text();
    const base = previewHlsUrl.slice(0, previewHlsUrl.lastIndexOf("/") + 1);
    const lines = playlist.split("\n").map((l) => l.trim());
    const init = lines.find((l) => l.startsWith("#EXT-X-MAP"))?.match(/URI="([^"]+)"/)?.[1];
    const segs = lines.filter((l) => l && !l.startsWith("#")).slice(0, segments);
    await Promise.all([init, ...segs].filter(Boolean).map((u) => fetch(new URL(u!, base).toString())));
  } catch {
    warmed.delete(previewHlsUrl);
  }
}
