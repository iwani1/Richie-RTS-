-- 020 — what a driver is licensed to drive (FLT-04, D-103)
--
-- The driver register held a licence number and an expiry date. Dispatch checked the date and
-- nothing else, so a driver licensed for a small car could be signed to a 45-seat coach and the
-- system would report that the licence was in order. The class is printed on the licence, and it is
-- the one thing that decides whether a driver may take a vehicle at all.
--
-- The classes are stored as the office reads them off the licence, not as a fixed list this
-- program invents: Ghana's DVLA classes are printed codes, and which of them covers a minibus,
-- a coach or a tipper is the operator's rule, declared per vehicle category in Settings.
--
-- Both columns default to an empty list, so every existing driver stays valid and every existing
-- vehicle category checks nothing until somebody classifies it. An empty cell is "not recorded",
-- not "no classes" — and the assignment check says so in those words, rather than pretending it
-- verified something.

alter table driver add column if not exists licence_classes text[] not null default '{}';
alter table driver add column if not exists qualifications  text[] not null default '{}';

comment on column driver.licence_classes is
  'The licence classes printed on the driver''s licence, upper-cased (FLT-04). Empty means not recorded.';
comment on column driver.qualifications is
  'Certificates the driver holds as the office names them (FLT-04). Recorded, not enforced.';
