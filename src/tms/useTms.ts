"use client";

// The browser's view of the system.
//
// In the prototype this module owned the database: it read localStorage, ran commands in the page
// and wrote back. The audit found the consequences — every rule was advisory, because the person
// with the browser was the server (audit/H-01, H-02, M-04). Here the browser holds nothing but a
// redacted snapshot and a cookie. `dispatch` sends an intent to /api/commands; the server decides,
// writes, and returns the new snapshot. Anything this module believes about permissions is UI
// polish, not enforcement.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { can, type Permission } from "./permissions";
import type { ClientCommand } from "./clientCommand";
import { PASSWORD_MIN_LENGTH, type Actor, type CommandResult } from "./service";
import { emptyDatabase, type Database, type User } from "./types";

export type Tone = "info" | "success" | "warning" | "error";
export interface Flash {
  tone: Tone;
  message: string;
}

export type LoadStatus = "loading" | "ready" | "offline";

export interface Tms {
  db: Database;
  actor: Actor | null;
  currentUser: User | null;
  status: LoadStatus;
  /** True while at least one command is in flight, so the shell can say "saving" instead of
   *  looking idle. Counted, not a boolean, because commands can overlap (a panel save while a
   *  background refresh is running). */
  busy: boolean;
  /** Why the app cannot reach the server, if it cannot. Shown in the shell, never swallowed. */
  connectionError: string | null;
  /** How many audit entries exist. The snapshot carries only the most recent window of them. */
  auditTotal: number;
  setupRequired: boolean;
  flash: Flash | null;
  setFlash: (flash: Flash | null) => void;
  allowed: (permission: Permission) => boolean;
  dispatch: (command: ClientCommand) => Promise<CommandResult>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  setupAdministrator: (fullName: string, email: string, password: string) => Promise<CommandResult>;
  exportBackup: () => Promise<string | null>;
  refresh: () => Promise<void>;
}

interface SessionPayload {
  ok: boolean;
  setupRequired?: boolean;
  user?: User | null;
  database?: Database | null;
  auditTotal?: number;
  message?: string;
}

async function postJson<T>(url: string, body?: unknown): Promise<{ status: number; data: T | null }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await response.json().catch(() => null)) as T | null;
  return { status: response.status, data };
}

const NETWORK_ERROR = "Cannot reach the server. Check that the application is running and reload.";

export function useTmsState(): Tms {
  const [db, setDb] = useState<Database>(emptyDatabase);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [inFlight, setInFlight] = useState(0);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [auditTotal, setAuditTotal] = useState(0);

  // Commands are serialised: the server applies them one at a time, and replies in the same order,
  // so the newest response is always the newest state. Sending them concurrently would let an
  // older snapshot overwrite a newer one on screen.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const applySession = useCallback((session: SessionPayload) => {
    setSetupRequired(Boolean(session.setupRequired));
    setCurrentUser(session.user ?? null);
    if (session.database) {
      setDb(session.database);
      setAuditTotal(session.auditTotal ?? session.database.audit.length);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
      const session = (await response.json().catch(() => null)) as SessionPayload | null;
      if (!session) {
        setConnectionError(NETWORK_ERROR);
        setStatus("offline");
        return;
      }
      if (!session.ok) {
        // Reachable but unhappy (database down, migrations missing): say so, do not pretend.
        setConnectionError(session.message ?? "The server reported a problem.");
        setStatus("offline");
        return;
      }
      applySession(session);
      setConnectionError(null);
      setStatus("ready");
    } catch {
      setConnectionError(NETWORK_ERROR);
      setStatus("offline");
    }
  }, [applySession]);

  // First paint: ask the server who we are and what we may see. There is no synchronous
  // fallback to a local database any more, so this effect is the only initial load.
  useEffect(() => {
    // The rule cannot see through `refresh`: every setState happens after an await, not
    // synchronously in the effect body. Loading the session once on mount is the intended
    // "subscribe to an external system" case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const actor = useMemo<Actor | null>(
    () => (currentUser ? { id: currentUser.id, fullName: currentUser.fullName, role: currentUser.role } : null),
    [currentUser],
  );

  const dispatch = useCallback(
    (command: ClientCommand): Promise<CommandResult> => {
      setInFlight((n) => n + 1);
      const run = async (): Promise<CommandResult> => {
        try {
          const { status: httpStatus, data } = await postJson<{
            ok: boolean;
            message?: string;
            errors?: Record<string, string>;
            database?: Database;
            auditTotal?: number;
          }>("/api/commands", command);
          if (httpStatus === 401) {
            setCurrentUser(null);
            setDb(emptyDatabase());
            return { ok: false, message: "Your session has ended. Sign in again.", errors: {} };
          }
          if (!data) return { ok: false, message: NETWORK_ERROR, errors: {} };
          if (!data.ok) return { ok: false, message: data.message ?? "The change was not saved.", errors: data.errors ?? {} };
          if (data.database) {
            setDb(data.database);
            setAuditTotal(data.auditTotal ?? data.database.audit.length);
          }
          return { ok: true, db: data.database ?? emptyDatabase(), message: data.message ?? "Saved." };
        } catch {
          setConnectionError(NETWORK_ERROR);
          setStatus("offline");
          return { ok: false, message: NETWORK_ERROR, errors: {} };
        }
      };
      const next = queue.current.then(run, run);
      queue.current = next.catch(() => undefined);
      return next.finally(() => setInFlight((n) => Math.max(0, n - 1)));
    },
    [],
  );

  const signIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      try {
        const { data } = await postJson<SessionPayload>("/api/auth/login", { email, password });
        if (!data?.ok) return data?.message ?? "Incorrect email or password.";
        applySession(data);
        setConnectionError(null);
        setStatus("ready");
        return null;
      } catch {
        return NETWORK_ERROR;
      }
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    await postJson("/api/auth/logout").catch(() => null);
    setCurrentUser(null);
    setDb(emptyDatabase());
    setFlash({ tone: "info", message: "Signed out." });
  }, []);

  const setupAdministrator = useCallback(
    async (fullName: string, email: string, password: string): Promise<CommandResult> => {
      if (password.length < PASSWORD_MIN_LENGTH) {
        const message = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
        return { ok: false, message, errors: { password: message } };
      }
      try {
        const { data } = await postJson<SessionPayload>("/api/setup", { fullName, email, password });
        if (!data?.ok) return { ok: false, message: data?.message ?? "The account could not be created.", errors: {} };
        applySession(data);
        setConnectionError(null);
        setStatus("ready");
        return { ok: true, db: data.database ?? emptyDatabase(), message: data.message ?? "Administrator account created." };
      } catch {
        return { ok: false, message: NETWORK_ERROR, errors: {} };
      }
    },
    [applySession],
  );

  const allowed = useCallback((permission: Permission) => can(actor?.role, permission), [actor]);

  const exportBackup = useCallback(async (): Promise<string | null> => {
    // Data leaving the system is a permissioned, audited event, not a read. The server records it
    // and refuses if the role lacks backup:export; the file itself is the redacted snapshot, so a
    // backup can never contain a password hash.
    const recorded = await dispatch({ type: "record_backup_export" });
    if (!recorded.ok) {
      setFlash({ tone: "error", message: recorded.message });
      return null;
    }
    return JSON.stringify(recorded.db, null, 2);
  }, [dispatch]);

  return {
    db,
    actor,
    currentUser,
    status,
    busy: inFlight > 0,
    connectionError,
    auditTotal,
    setupRequired,
    flash,
    setFlash,
    allowed,
    dispatch,
    signIn,
    signOut,
    setupAdministrator,
    exportBackup,
    refresh,
  };
}

export const TmsContext = createContext<Tms | null>(null);

export function useTms(): Tms {
  const ctx = useContext(TmsContext);
  if (!ctx) throw new Error("useTms must be used inside TmsContext.Provider");
  return ctx;
}
