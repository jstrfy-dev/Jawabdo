CREATE TABLE IF NOT EXISTS whatsapp_delivery_statuses (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  whatsapp_message_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  error_code text,
  event_timestamp bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, whatsapp_message_id)
);

CREATE INDEX IF NOT EXISTS whatsapp_delivery_statuses_updated_idx
  ON whatsapp_delivery_statuses(updated_at);

ALTER TABLE whatsapp_delivery_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_delivery_statuses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whatsapp_delivery_statuses;
CREATE POLICY tenant_isolation ON whatsapp_delivery_statuses
  USING (current_setting('app.is_worker', true) = 'true' OR business_id::text = current_setting('app.current_business_id', true))
  WITH CHECK (current_setting('app.is_worker', true) = 'true' OR business_id::text = current_setting('app.current_business_id', true));
