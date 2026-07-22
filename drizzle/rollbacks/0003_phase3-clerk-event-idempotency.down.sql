BEGIN;
ALTER TABLE identity_webhook_events DROP CONSTRAINT IF EXISTS chk_identity_webhook_events_payload_sha256;
ALTER TABLE identity_webhook_events DROP COLUMN last_error_code;
ALTER TABLE identity_webhook_events DROP COLUMN payload_sha256;
ALTER TABLE identity_webhook_events DROP COLUMN received_at;
ALTER TABLE identity_webhook_events DROP COLUMN clerk_occurred_at;
COMMIT;
