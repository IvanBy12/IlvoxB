DROP INDEX IF EXISTS "idx_deliverables_project_party_status";
ALTER TABLE "deliverables" DROP CONSTRAINT IF EXISTS "chk_deliverables_client_due_date";
ALTER TABLE "deliverables" DROP CONSTRAINT IF EXISTS "chk_deliverables_delivery_party";
ALTER TABLE "deliverables" DROP COLUMN IF EXISTS "due_date";
ALTER TABLE "deliverables" DROP COLUMN IF EXISTS "delivery_party";
