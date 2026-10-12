/**
 * Chunked, resumable upload straight to a GCS resumable session URI (any file size; GCS
 * objects go up to 5 TiB). Survives dropped connections: on failure we ask GCS how many bytes
 * it has and continue from there. The session URI is persisted so an app restart can resume
 * (sessions stay valid for 7 days).
 *
 * Protocol: https://cloud.google.com/storage/docs/performing-resumable-uploads
 */
import { config } from "@/config";
import { saveSession, clearSession } from "./sessionStore";

export interface ChunkSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array | Blob>;
}

export type UploadProgress = { sentBytes: number; totalBytes: number };

const MAX_RETRIES = 12;

export async function resumableUpload(
  productId: string,
  sessionUri: string,
  source: ChunkSource,
  onProgress?: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  await saveSession(productId, sessionUri);
  let offset = await queryOffset(sessionUri, source.size);
  let retries = 0;

  while (offset < source.size) {
    if (signal?.aborted) throw new Error("Upload cancelled");
    const end = Math.min(offset + config.uploadChunkBytes, source.size);
    try {
      const body = await source.read(offset, end - offset);
      const res = await fetch(sessionUri, {
        method: "PUT",
        headers: { "Content-Range": `bytes ${offset}-${end - 1}/${source.size}` },
        body: body as BodyInit,
        signal,
      });
      if (res.status === 200 || res.status === 201) {
        offset = source.size;
      } else if (res.status === 308) {
        offset = parseRange(res.headers.get("Range"));
      } else if (res.status >= 500 || res.status === 429) {
        throw new Error(`Retryable ${res.status}`);
      } else {
        throw Object.assign(new Error(`Upload rejected: ${res.status}`), { fatal: true });
      }
      retries = 0;
      onProgress?.({ sentBytes: offset, totalBytes: source.size });
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal || signal?.aborted || ++retries > MAX_RETRIES) throw e;
      await sleep(Math.min(30_000, 500 * 2 ** retries) * (0.5 + Math.random()));
      offset = await queryOffset(sessionUri, source.size).catch(() => offset);
    }
  }
  await clearSession(productId);
}

async function queryOffset(sessionUri: string, total: number): Promise<number> {
  const res = await fetch(sessionUri, { method: "PUT", headers: { "Content-Range": `bytes */${total}` } });
  if (res.status === 200 || res.status === 201) return total;
  if (res.status === 308) return parseRange(res.headers.get("Range"));
  throw new Error(`Could not query upload status: ${res.status}`);
}

/** GCS returns "bytes=0-N" for the persisted range; next byte to send is N+1. */
function parseRange(range: string | null): number {
  const m = range?.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
