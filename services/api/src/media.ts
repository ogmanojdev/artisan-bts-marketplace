import { env } from "./env.js";

export const mediaUrl = (path: string | null | undefined) => (path ? `${env.MEDIA_BASE_URL.replace(/\/$/, "")}/${path}` : null);

/** Raw uploads live at raw/<productId>/<file>; the transcoder derives the product from the path. */
export const rawObjectName = (productId: string, fileName: string) =>
  `raw/${productId}/${Date.now()}-${fileName.replace(/[^\w.\-]+/g, "_").slice(-120)}`;

export function productIdFromRawObject(name: string): string | null {
  const m = name.match(/^raw\/([0-9a-f-]{36})\//);
  return m ? m[1]! : null;
}
