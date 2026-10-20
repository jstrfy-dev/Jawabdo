ALTER TABLE reminder_jobs
  DROP CONSTRAINT IF EXISTS reminder_jobs_status_check;

ALTER TABLE reminder_jobs
  ADD CONSTRAINT reminder_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'delivered', 'read', 'failed', 'cancelled'));

ALTER TABLE webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_business_id_fkey;

ALTER TABLE webhook_events
  ADD CONSTRAINT webhook_events_business_id_fkey
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
