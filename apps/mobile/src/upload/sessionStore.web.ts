/** Web: localStorage is enough for a session URI (IndexedDB if we ever store chunks). */
const key = (productId: string) => `upload_session_${productId}`;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export async function saveSession(productId: string, sessionUri: string) {
  storage()?.setItem(key(productId), sessionUri);
}

export async function loadSession(productId: string) {
  return storage()?.getItem(key(productId)) ?? null;
}

export async function clearSession(productId: string) {
  storage()?.removeItem(key(productId));
}
