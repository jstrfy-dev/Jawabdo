CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_unique
  ON app_users (lower(email))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  timezone text NOT NULL DEFAULT 'Asia/Karachi',
  language text NOT NULL DEFAULT 'roman',
  owner_name text NOT NULL DEFAULT '',
  owner_phone text NOT NULL DEFAULT '',
  owner_whatsapp_opt_in boolean NOT NULL DEFAULT false,
  opening_hours jsonb NOT NULL DEFAULT '[]'::jsonb,
  policies jsonb NOT NULL DEFAULT '{}'::jsonb,
  human_handoff_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_memberships (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id)
);

CREATE INDEX IF NOT EXISTS business_memberships_user_idx ON business_memberships(user_id);

CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_minor bigint,
  currency char(3) NOT NULL DEFAULT 'PKR',
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 1440),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS services_business_name_unique ON services(business_id, lower(name));

CREATE TABLE IF NOT EXISTS business_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);

CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  meta_business_id text NOT NULL,
  waba_id text NOT NULL,
  phone_number_id text NOT NULL UNIQUE,
  display_phone_number text NOT NULL DEFAULT '',
  encrypted_access_token text NOT NULL,
  token_expires_at timestamptz,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connecting', 'connected', 'needs_attention', 'disconnected')),
  last_webhook_at timestamptz,
  last_error_code text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  whatsapp_user_id text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  phone_number text NOT NULL,
  service_message_opt_in_at timestamptz,
  reminder_opt_in_at timestamptz,
  opted_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, whatsapp_user_id),
  UNIQUE (business_id, id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'ai' CHECK (state IN ('ai', 'needs_owner', 'owner_handling', 'closed')),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, customer_id),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, customer_id) REFERENCES customers(business_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender text NOT NULL CHECK (sender IN ('customer', 'assistant', 'owner', 'system')),
  body text NOT NULL,
  whatsapp_message_id text,
  delivery_status text NOT NULL DEFAULT 'received'
    CHECK (delivery_status IN ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, conversation_id) REFERENCES conversations(business_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS messages_whatsapp_id_unique
  ON messages(whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_conversation_time_idx
  ON messages(business_id, conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  conversation_id uuid,
  service_id uuid,
  service_name text NOT NULL,
  staff_key text NOT NULL DEFAULT 'default',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'pending_confirmation'
    CHECK (status IN ('pending_confirmation', 'confirmed', 'cancelled', 'completed')),
  customer_confirmed_at timestamptz,
  reminder_opt_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, customer_id) REFERENCES customers(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, conversation_id) REFERENCES conversations(business_id, id),
  FOREIGN KEY (business_id, service_id) REFERENCES services(business_id, id),
  EXCLUDE USING gist (
    business_id WITH =,
    staff_key WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'confirmed')
);

CREATE INDEX IF NOT EXISTS bookings_business_start_idx ON bookings(business_id, starts_at);

CREATE TABLE IF NOT EXISTS reminder_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL,
  recipient_type text NOT NULL CHECK (recipient_type IN ('customer', 'owner')),
  recipient_phone text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'delivered', 'read', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  whatsapp_message_id text,
  error_code text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, booking_id, recipient_type),
  FOREIGN KEY (business_id, booking_id) REFERENCES bookings(business_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS reminder_jobs_due_idx ON reminder_jobs(scheduled_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  phone_number_id text NOT NULL,
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'processed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  error_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

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

CREATE INDEX IF NOT EXISTS webhook_events_queue_idx ON webhook_events(received_at) WHERE status IN ('queued', 'failed');

CREATE TABLE IF NOT EXISTS signup_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  state_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signup_sessions_expiry_idx ON signup_sessions(expires_at);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'services', 'business_faqs', 'whatsapp_connections',
    'customers', 'conversations', 'messages', 'bookings', 'reminder_jobs',
    'webhook_events', 'whatsapp_delivery_statuses'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (current_setting(''app.is_worker'', true) = ''true'' OR business_id::text = current_setting(''app.current_business_id'', true)) WITH CHECK (current_setting(''app.is_worker'', true) = ''true'' OR business_id::text = current_setting(''app.current_business_id'', true))',
      table_name
    );
  END LOOP;

  ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
  ALTER TABLE businesses FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON businesses;
  CREATE POLICY tenant_isolation ON businesses
    USING (current_setting('app.is_worker', true) = 'true' OR id::text = current_setting('app.current_business_id', true))
    WITH CHECK (current_setting('app.is_worker', true) = 'true' OR id::text = current_setting('app.current_business_id', true));

  ALTER TABLE business_memberships ENABLE ROW LEVEL SECURITY;
  ALTER TABLE business_memberships FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS membership_owner_access ON business_memberships;
  CREATE POLICY membership_owner_access ON business_memberships
    USING (user_id::text = current_setting('app.current_user_id', true))
    WITH CHECK (user_id::text = current_setting('app.current_user_id', true));

  ALTER TABLE signup_sessions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE signup_sessions FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS signup_session_owner_access ON signup_sessions;
  CREATE POLICY signup_session_owner_access ON signup_sessions
    USING (user_id::text = current_setting('app.current_user_id', true))
    WITH CHECK (user_id::text = current_setting('app.current_user_id', true));
END
$$;
