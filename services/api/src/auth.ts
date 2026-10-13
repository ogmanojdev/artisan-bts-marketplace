import type { FastifyReply, FastifyRequest } from "fastify";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { OAuth2Client } from "google-auth-library";
import { env } from "./env.js";

export type Role = "artisan" | "buyer";
export type User = { uid: string; role: Role; name: string };

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
  }
}

if (!getApps().length) initializeApp({ projectId: env.GCP_PROJECT_ID });

async function verify(token: string): Promise<User> {
  if (env.DEV_AUTH === "true" && token.startsWith("dev:")) {
    const [, uid, role] = token.split(":");
    return { uid: uid!, role: (role as Role) ?? "buyer", name: uid! };
  }
  const decoded = await getAuth().verifyIdToken(token);
  return {
    uid: decoded.uid,
    role: decoded.role === "artisan" ? "artisan" : "buyer",
    name: (decoded.name as string | undefined) ?? decoded.phone_number ?? "Maker",
  };
}

export function requireUser(role?: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return reply.code(401).send({ error: "Sign in required" });
    try {
      req.user = await verify(header.slice(7));
    } catch {
      return reply.code(401).send({ error: "Invalid session" });
    }
    if (role && req.user.role !== role) return reply.code(403).send({ error: `Only ${role}s can do this` });
  };
}

const oidc = new OAuth2Client();

/** Pub/Sub push endpoints: accept only OIDC tokens minted for our push service account. */
export async function requirePubSubPush(req: FastifyRequest, reply: FastifyReply) {
  // Local only (no audience configured). A deployed API keeps the OIDC check even with DEV_AUTH on.
  if (env.DEV_AUTH === "true" && !env.INTERNAL_AUDIENCE) return;
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!token) return reply.code(401).send();
  try {
    const ticket = await oidc.verifyIdToken({ idToken: token, audience: env.INTERNAL_AUDIENCE });
    if (ticket.getPayload()?.email !== env.PUBSUB_PUSH_SA) return reply.code(403).send();
  } catch {
    return reply.code(401).send();
  }
}
