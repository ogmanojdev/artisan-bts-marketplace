/** Android: read byte ranges from the picked file without loading it all into memory. */
import { File } from "expo-file-system";
import type { ChunkSource } from "./resumableUpload";

export async function chunkSourceFromAsset(asset: { uri: string; size?: number | null }): Promise<ChunkSource> {
  const file = new File(asset.uri);
  const size = asset.size ?? file.size ?? 0;
  return {
    size,
    async read(offset, length) {
      const handle = file.open();
      try {
        handle.offset = offset;
        return handle.readBytes(length);
      } finally {
        handle.close();
      }
    },
  };
}
