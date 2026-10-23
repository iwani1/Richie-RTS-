// Session handling.
//
// The brief says "never hand-roll sessions or password hashing". This uses iron-session, a
// maintained library that seals the session payload into an encrypted, integrity-checked cookie
// (AES-256-GCM via its stateless mode), so no session token is written by hand and nothing
// session-related is stored in the database. Decision D-51 records why this rather than
// Auth.js/Better Auth, and what it would take to move later.
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { env } from "./env";

export interface SessionData {
  userId?: string;
  signedInAt?: string;
}

export const SESSION_COOKIE = "richie_tms_session";

function options(): SessionOptions {
  const secure = env().NODE_ENV === "production";
  return {
    cookieName: SESSION_COOKIE,
    password: env().SESSION_SECRET,
    ttl: 60 * 60 * 8, // one working shift
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), options());
}

export async function currentUserId(): Promise<string | null> {
  const session = await getSession();
  return session.userId ?? null;
}

export async function signInAs(userId: string): Promise<void> {
  const session = await getSession();
  // Rotate the whole payload on every sign-in; the library re-seals the cookie.
  session.userId = userId;
  session.signedInAt = new Date().toISOString();
  await session.save();
}

export async function signOut(): Promise<void> {
  const session = await getSession();
  session.destroy();
}
