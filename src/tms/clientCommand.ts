// The browser's command vocabulary.
//
// It is the server's command union minus the things a browser must never be able to ask for:
//   - `setup_administrator` exists only on /api/setup, which refuses once an account exists;
//   - `import_backup` is a server-side restore (scripts/restore.ts), because a client-supplied
//     database would overwrite every table and every credential;
//   - commands that set a credential take a `password`, never a pre-computed hash. The server
//     hashes it with Argon2id. The browser cannot mint or choose a hash.
//
// Anything not in this union will not compile at a call site, and the API rejects it at runtime
// as well (defence in depth, brief §5.3).
import type { AnyCommand } from "./commands";
import type { UserInput } from "./service";

export type ClientCreateUser = { type: "create_user"; input: UserInput; password: string };
export type ClientResetPassword = { type: "reset_user_password"; id: string; password: string };

type BrowserForbidden =
  | { type: "setup_administrator" }
  | { type: "import_backup" }
  | { type: "create_user" }
  | { type: "reset_user_password" };

export type ClientCommand =
  | Exclude<AnyCommand, BrowserForbidden>
  | ClientCreateUser
  | ClientResetPassword;

export type ClientCommandType = ClientCommand["type"];
