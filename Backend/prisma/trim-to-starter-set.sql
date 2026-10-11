-- Trim the local DriftGuard database down to the 5 starter showcase APIs.
--
-- Run once (the private cluster must be up):
--   psql -h 127.0.0.1 -p 5433 -U hackwave driftguard -f prisma/trim-to-starter-set.sql
--
-- What it does
--   1. Deletes every monitor that is not one of the 5 starter APIs. Checks,
--      baselines, mappings, incidents and proposals cascade with the monitor.
--   2. Deletes already-resolved incidents (their proposals cascade), so the
--      Incidents and Recovery pages only show what still needs attention.
--   3. Keeps only the latest 20 checks per monitor.
--   4. Slows polling to every 60 s.

BEGIN;

DELETE FROM monitors
WHERE url NOT IN (
  'http://127.0.0.1:3000/mock/demo/users/profile',
  'http://127.0.0.1:3000/mock/demo/geo/location',
  'http://127.0.0.1:3000/mock/demo/orders/recent',
  'http://127.0.0.1:3000/mock/demo/inventory/stock',
  'http://127.0.0.1:3000/mock/demo/auth/session'
);

DELETE FROM monitor_incidents WHERE status = 'RESOLVED';

DELETE FROM monitor_checks c
USING (
  SELECT id
  FROM (
    SELECT id, row_number() OVER (PARTITION BY "monitorId" ORDER BY "checkedAt" DESC) AS rn
    FROM monitor_checks
  ) t
  WHERE rn > 20
) old
WHERE c.id = old.id;

UPDATE monitors SET "intervalSec" = 60;

COMMIT;

SELECT 'monitors'  AS table_name, count(*) FROM monitors
UNION ALL SELECT 'checks',    count(*) FROM monitor_checks
UNION ALL SELECT 'incidents', count(*) FROM monitor_incidents
UNION ALL SELECT 'proposals', count(*) FROM recovery_proposals;
