/** Persist in-flight upload sessions so uploads resume after an app restart. */
import * as SecureStore from "expo-secure-store";

const key = (productId: string) => `upload_session_${productId.replace(/-/g, "")}`;

export async function saveSession(productId: string, sessionUri: string) {
  await SecureStore.setItemAsync(key(productId), sessionUri);
}

export async function loadSession(productId: string) {
  return SecureStore.getItemAsync(key(productId));
}

export async function clearSession(productId: string) {
  await SecureStore.deleteItemAsync(key(productId));
}
