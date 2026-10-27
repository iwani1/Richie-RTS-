-- RNT-02 (D-120): the stages a rental request goes through.
--
-- One word changed. A hire that has left the yard was stored as 'in_progress' and is now
-- 'dispatched' — the same word the trip board uses for the same moment, and the instant the hire's
-- run records as its departure (D-118). Nothing else about a stored hire changes: the three triage
-- states before a price (submitted, under review, awaiting quotation) and the "accepted, deposit due"
-- stage are states a request reaches from here on, and inventing them for older records would be
-- writing a history nobody wrote.
--
-- The status is stored twice — a text column for queries and indexes, and inside the JSON document
-- the application loads — so both are updated, in one statement, and only for the rows that need it.
update rental
set status = 'dispatched',
    data = jsonb_set(data, '{status}', '"dispatched"')
where status = 'in_progress';
