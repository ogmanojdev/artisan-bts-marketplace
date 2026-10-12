export async function measureDurationSeconds(asset: { file?: File; uri: string }): Promise<number> {
  const url = asset.file ? URL.createObjectURL(asset.file) : asset.uri;
  try {
    return await new Promise<number>((resolve, reject) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => resolve(v.duration);
      v.onerror = () => reject(new Error("Could not read video metadata"));
      v.src = url;
    });
  } finally {
    if (asset.file) URL.revokeObjectURL(url);
  }
}
