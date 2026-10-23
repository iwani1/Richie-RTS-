import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cryptoAvailable, hashPassword, verifyPassword } from "./crypto";
import { can, type Permission } from "./permissions";
import { execute, PASSWORD_MIN_LENGTH, type Actor, type CommandResult } from "./service";
import { executeCommand, type AnyCommand } from "./commands";
import { emptyDatabase, migrate, type Database, type User } from "./types";

const DB_KEY = "richie-tms:db:v1";
const SESSION_KEY = "richie-tms:session";

export type Tone = "info" | "success" | "warning" | "error";
export interface Flash {
  tone: Tone;
  message: string;
}

export interface Tms {
  db: Database;
  actor: Actor | null;
  currentUser: User | null;
  storageError: string | null;
  flash: Flash | null;
  setFlash: (flash: Flash | null) => void;
  allowed: (permission: Permission) => boolean;
  dispatch: (command: AnyCommand) => CommandResult;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => void;
  setupAdministrator: (fullName: string, email: string, password: string) => Promise<CommandResult>;
  createCredential: (password: string) => Promise<{ ok: true; credential: { passwordHash: string; passwordSalt: string } } | { ok: false; error: string }>;
  exportBackup: () => string | null;
}

function loadDatabase(): Database {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return emptyDatabase();
    const parsed: unknown = JSON.parse(raw);
    return migrate(parsed) ?? emptyDatabase();
  } catch {
    return emptyDatabase();
  }
}

function loadSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function useTmsState(): Tms {
  const [db, setDb] = useState<Database>(loadDatabase);
  const dbRef = useRef(db);
  const [sessionUserId, setSessionUserId] = useState<string | null>(loadSession);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);

  // Persist synchronously at the single point where state changes (commit below), not in an
  // effect after the fact. Persisting in an effect meant setState inside an effect on every
  // write (a cascading render), and a window after commit where React state and storage
  // disagreed. The one write that does not go through commit is the initial load, handled
  // once on mount here.
  const persist = useCallback((next: Database): string | null => {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(next));
      return null;
    } catch (error) {
      return `Browser storage write failed: ${error instanceof Error ? error.message : "unknown error"}. Changes are not being saved.`;
    }
  }, []);

  useEffect(() => {
    // Mount only: surface a storage problem that already exists for the loaded database
    // (for example a quota exhausted before this session), without a render-time setState.
    const error = persist(dbRef.current);
    if (error !== null) queueMicrotask(() => setStorageError(error));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(t);
  }, [flash]);

  const currentUser = useMemo(() => db.users.find((u) => u.id === sessionUserId && u.active) ?? null, [db.users, sessionUserId]);
  const actor = useMemo<Actor | null>(() => (currentUser ? { id: currentUser.id, fullName: currentUser.fullName, role: currentUser.role } : null), [currentUser]);
  const actorRef = useRef(actor);
  // Keep the ref in sync in an effect, not during render. Under concurrent rendering a
  // render can start and be discarded; writing the ref during render would leave
  // dispatch() acting as a stale (or never-committed) actor.
  useEffect(() => {
    actorRef.current = actor;
  }, [actor]);

  const commit = useCallback(
    (next: Database) => {
      dbRef.current = next;
      setDb(next);
      const error = persist(next);
      setStorageError((previous) => (previous === error ? previous : error));
    },
    [persist],
  );

  const dispatch = useCallback(
    (command: AnyCommand): CommandResult => {
      const result = executeCommand(dbRef.current, actorRef.current, command);
      if (result.ok) commit(result.db);
      return result;
    },
    [commit],
  );

  const createCredential = useCallback(async (password: string) => {
    if (password.length < PASSWORD_MIN_LENGTH) return { ok: false as const, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
    if (!cryptoAvailable()) return { ok: false as const, error: "Web Crypto is unavailable (a secure context such as HTTPS or localhost is required)." };
    return { ok: true as const, credential: await hashPassword(password) };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      if (!cryptoAvailable()) return "Web Crypto is unavailable (a secure context such as HTTPS or localhost is required).";
      const user = dbRef.current.users.find((u) => u.email === email.trim().toLowerCase());
      // Same message for unknown user, inactive user and wrong password.
      const generic = "Incorrect email or password.";
      if (!user || !user.active) return generic;
      const ok = await verifyPassword(password, user);
      if (!ok) return generic;
      const signedInActor: Actor = { id: user.id, fullName: user.fullName, role: user.role };
      const result = execute(dbRef.current, signedInActor, { type: "record_sign_in" });
      if (result.ok) commit(result.db);
      try {
        sessionStorage.setItem(SESSION_KEY, user.id);
      } catch {
        // Session will last for this page only.
      }
      setSessionUserId(user.id);
      return null;
    },
    [commit],
  );

  const signOut = useCallback(() => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
    setSessionUserId(null);
    setFlash({ tone: "info", message: "Signed out." });
  }, []);

  const setupAdministrator = useCallback(
    async (fullName: string, email: string, password: string): Promise<CommandResult> => {
      const cred = await createCredential(password);
      if (!cred.ok) return { ok: false, message: cred.error, errors: { password: cred.error } };
      const result = execute(dbRef.current, null, { type: "setup_administrator", input: { fullName, email }, credential: cred.credential });
      if (result.ok) {
        commit(result.db);
        const user = result.db.users[0];
        try {
          sessionStorage.setItem(SESSION_KEY, user.id);
        } catch {
          // ignore
        }
        setSessionUserId(user.id);
      }
      return result;
    },
    [commit, createCredential],
  );

  const allowed = useCallback((permission: Permission) => can(actor?.role, permission), [actor]);

  const exportBackup = useCallback(() => {
    // Data egress is a permissioned, audited action, not a read. `backup:export` is what the
    // service layer checks; the button gating in the UI is convenience, not the boundary.
    const recorded = dispatch({ type: "record_backup_export" });
    if (!recorded.ok) return null;
    return JSON.stringify(dbRef.current, null, 2);
  }, [dispatch]);

  return { db, actor, currentUser, storageError, flash, setFlash, allowed, dispatch, signIn, signOut, setupAdministrator, createCredential, exportBackup };
}

export const TmsContext = createContext<Tms | null>(null);

export function useTms(): Tms {
  const ctx = useContext(TmsContext);
  if (!ctx) throw new Error("useTms must be used inside TmsContext.Provider");
  return ctx;
}
