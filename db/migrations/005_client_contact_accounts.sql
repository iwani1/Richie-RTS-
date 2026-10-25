-- 005 — a client may have several contact accounts (Q-38, D-77)
--
-- 001 enforced "one account per record" with a unique index on app_user.client_id, matching the
-- service layer. The company's answer is the opposite for clients: an operations contact and an
-- accounts contact each get their own login, each confined to that one client, rather than sharing
-- a password. The driver rule stands - a driver record is that person's record, so it keeps its
-- index.
--
-- No data is rewritten: an existing client with one contact account simply becomes a client that
-- may have another. "Which one we ring first" is `primaryContact` on the account's data, and the
-- service layer keeps it to one per client.

drop index if exists app_user_client_uq;
