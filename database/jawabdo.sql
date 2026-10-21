CREATE DATABASE IF NOT EXISTS jawabdo
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE jawabdo;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE IF NOT EXISTS app_users (
  id CHAR(36) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email_verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY app_users_email_unique (email),
  KEY app_users_deleted_idx (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS businesses (
  id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT '',
  address VARCHAR(300) NOT NULL DEFAULT '',
  timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Karachi',
  language VARCHAR(10) NOT NULL DEFAULT 'roman',
  owner_name VARCHAR(120) NOT NULL DEFAULT '',
  owner_phone VARCHAR(20) NOT NULL DEFAULT '',
  owner_whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  opening_hours JSON NOT NULL,
  policies JSON NOT NULL,
  human_handoff_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_memberships (
  business_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role ENUM('owner', 'manager', 'staff') NOT NULL DEFAULT 'owner',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (business_id, user_id),
  KEY business_memberships_user_idx (user_id),
  CONSTRAINT business_memberships_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT business_memberships_user_fk FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS services (
  id CHAR(36) NOT NULL,
  business_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(1000) NOT NULL DEFAULT '',
  currency CHAR(3) NOT NULL DEFAULT 'PKR',
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY services_business_id_unique (business_id, id),
  UNIQUE KEY services_business_name_unique (business_id, name),
  CONSTRAINT services_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT services_duration_check CHECK (duration_minutes BETWEEN 5 AND 1440)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS service_prices (
  id CHAR(36) NOT NULL,
  business_id CHAR(36) NOT NULL,
  service_id CHAR(36) NOT NULL,
  price_minor BIGINT UNSIGNED NULL,
  effective_from DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY service_prices_service_unique (business_id, service_id),
  CONSTRAINT service_prices_service_fk FOREIGN KEY (business_id, service_id) REFERENCES services(business_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_hours (
  business_id CHAR(36) NOT NULL,
  day_of_week TINYINT UNSIGNED NOT NULL,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  opens_at TIME NULL,
  closes_at TIME NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (business_id, day_of_week),
  CONSTRAINT business_hours_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT business_hours_day_check CHECK (day_of_week BETWEEN 0 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_faqs (
  id CHAR(36) NOT NULL,
  business_id CHAR(36) NOT NULL,
  question VARCHAR(500) NOT NULL,
  answer VARCHAR(2000) NOT NULL,
  verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY business_faqs_business_id_unique (business_id, id),
  KEY business_faqs_order_idx (business_id, created_at),
  CONSTRAINT business_faqs_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS whatsapp_connections (
  id CHAR(36) NOT NULL,
  business_id CHAR(36) NOT NULL,
  meta_business_id VARCHAR(100) NOT NULL,
  waba_id VARCHAR(100) NOT NULL,
  phone_number_id VARCHAR(100) NOT NULL,
  display_phone_number VARCHAR(40) NOT NULL DEFAULT '',
  encrypted_access_token TEXT NOT NULL,
  token_expires_at DATETIME(3) NULL,
  status ENUM('connecting', 'connected', 'needs_attention', 'disconnected') NOT NULL DEFAULT 'connecting',
  last_webhook_at DATETIME(3) NULL,
  last_error_code VARCHAR(100) NULL,
  connected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY whatsapp_connections_business_unique (business_id),
  UNIQUE KEY whatsapp_connections_phone_unique (phone_number_id),
  CONSTRAINT whatsapp_connections_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id CHAR(36) NOT NULL,
  business_id CHAR(36) NOT NULL,
  whatsapp_user_id VARCHAR(100) NOT NULL,
  display_name VARCHAR(120) NOT NULL DEFAULT '',
  phone_number VARCHAR(20) NOT NULL,
  notes TEXT NOT NULL,
  tags JSON NOT NULL,
  service_message_opt_in_at DATETIME(3) NULL,
  reminder_opt_in_at DATETIME(3) NULL,
  opted_out_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY customers_business_whatsapp_unique (business_id, whatsapp_user_id),
  UNIQUE KEY customers_business_id_unique (business_id, id),
  KEY customers_business_name_idx (business_id, display_name),
  CONSTRAINT customers_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversations (
  id CHAR(36) NOT NULL,
  business_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  state ENUM('ai', 'needs_owner', 'owner_handling', 'closed') NOT NULL DEFAULT 'ai',
  last_message_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY conversations_business_customer_unique (business_id, customer_id),
  UNIQUE KEY conversations_business_id_unique (business_id, id),
  KEY conversations_business_recent_idx (business_id, last_message_at),
  CONSTRAINT conversations_customer_fk FOREIGN KEY (business_id, customer_id) REFERENCES customers(business_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id CHAR(36) NOT NULL,
  business_id CHAR(36) NOT NULL,
  conversation_id CHAR(36) NOT NULL,
  direction ENUM('inbound', 'outbound') NOT NULL,
  sender ENUM('customer', 'assistant', 'owner', 'system') NOT NULL,
  body TEXT NOT NULL,
  whatsapp_message_id VARCHAR(191) NULL,
  delivery_status ENUM('received', 'queued', 'sent', 'delivered', 'read', 'failed') NOT NULL DEFAULT 'received',
  error_code VARCHAR(100) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY messages_business_whatsapp_unique (business_id, whatsapp_message_id),
  KEY messages_conversation_time_idx (business_id, conversation_id, created_at),
  CONSTRAINT messages_conversation_fk FOREIGN KEY (business_id, conversation_id) REFERENCES conversations(business_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointments (
  id CHAR(36) NOT NULL,
  business_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  conversation_id CHAR(36) NULL,
  service_id CHAR(36) NULL,
  service_name VARCHAR(120) NOT NULL,
  price_minor BIGINT UNSIGNED NULL,
  staff_key VARCHAR(100) NOT NULL DEFAULT 'default',
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  timezone VARCHAR(100) NOT NULL,
  status ENUM('pending_confirmation', 'confirmed', 'cancelled', 'completed') NOT NULL DEFAULT 'pending_confirmation',
  customer_confirmed_at DATETIME(3) NULL,
  reminder_opt_in_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY appointments_business_id_unique (business_id, id),
  KEY appointments_business_start_idx (business_id, starts_at),
  KEY appointments_staff_overlap_idx (business_id, staff_key, status, starts_at, ends_at),
  CONSTRAINT appointments_customer_fk FOREIGN KEY (business_id, customer_id) REFERENCES customers(business_id, id) ON DELETE CASCADE,
  CONSTRAINT appointments_conversation_fk FOREIGN KEY (business_id, conversation_id) REFERENCES conversations(business_id, id),
  CONSTRAINT appointments_service_fk FOREIGN KEY (business_id, service_id) REFERENCES services(business_id, id),
  CONSTRAINT appointments_time_check CHECK (ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reminder_jobs (
  id CHAR(36) NOT NULL,
  business_id CHAR(36) NOT NULL,
  appointment_id CHAR(36) NOT NULL,
  recipient_type ENUM('customer', 'owner') NOT NULL,
  recipient_phone VARCHAR(20) NOT NULL,
  scheduled_at DATETIME(3) NOT NULL,
  status ENUM('pending', 'processing', 'sent', 'delivered', 'read', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  whatsapp_message_id VARCHAR(191) NULL,
  error_code VARCHAR(100) NULL,
  sent_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY reminder_jobs_appointment_recipient_unique (business_id, appointment_id, recipient_type),
  KEY reminder_jobs_due_idx (status, scheduled_at),
  CONSTRAINT reminder_jobs_appointment_fk FOREIGN KEY (business_id, appointment_id) REFERENCES appointments(business_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webhook_events (
  id CHAR(36) NOT NULL,
  event_key VARCHAR(191) NOT NULL,
  phone_number_id VARCHAR(100) NOT NULL,
  business_id CHAR(36) NULL,
  event_type VARCHAR(50) NOT NULL,
  payload JSON NOT NULL,
  status ENUM('queued', 'processing', 'processed', 'failed') NOT NULL DEFAULT 'queued',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(100) NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY webhook_events_event_key_unique (event_key),
  KEY webhook_events_queue_idx (status, received_at),
  CONSTRAINT webhook_events_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS whatsapp_delivery_statuses (
  business_id CHAR(36) NOT NULL,
  whatsapp_message_id VARCHAR(191) NOT NULL,
  status ENUM('sent', 'delivered', 'read', 'failed') NOT NULL,
  error_code VARCHAR(100) NULL,
  event_timestamp BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (business_id, whatsapp_message_id),
  KEY whatsapp_delivery_statuses_updated_idx (updated_at),
  CONSTRAINT whatsapp_delivery_statuses_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS signup_sessions (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  business_id CHAR(36) NOT NULL,
  state_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY signup_sessions_state_hash_unique (state_hash),
  KEY signup_sessions_expiry_idx (expires_at),
  CONSTRAINT signup_sessions_user_fk FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT signup_sessions_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_name VARCHAR(191) NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (migration_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations(migration_name) VALUES ('001_initial_mysql_schema');
