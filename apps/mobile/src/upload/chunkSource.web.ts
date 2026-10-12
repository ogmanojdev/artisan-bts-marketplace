/** Web: Blob.slice gives cheap range reads of the selected File. */
import type { ChunkSource } from "./resumableUpload";

export async function chunkSourceFromAsset(asset: { file?: File; size?: number | null }): Promise<ChunkSource> {
  if (!asset.file) throw new Error("No file selected");
  const file = asset.file;
  return {
    size: file.size,
    async read(offset, length) {
      return file.slice(offset, offset + length);
    },
  };
}
