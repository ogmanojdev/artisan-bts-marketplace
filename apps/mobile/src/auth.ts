/**
 * Auth seam. Wire this to Identity Platform (Firebase Auth) phone OTP + Google sign-in.
 * The API verifies the ID token with firebase-admin and reads the `role` custom claim
 * (`artisan` | `buyer`).
 *
 * Kept as a tiny module so screens never depend on a specific auth SDK.
 */
import { config } from "./config";

/** Sign-in is out of scope: with dev auth, one demo user both lists and buys (`dev:<uid>:<role>`). */
const DEV_TOKEN = "dev:demo-user:artisan";

let currentToken: string | null = null;

export function setIdToken(token: string | null) {
  currentToken = token;
}

export async function getIdToken(): Promise<string | null> {
  return currentToken ?? (config.devAuth ? DEV_TOKEN : null);
}
