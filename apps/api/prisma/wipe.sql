-- ============================================================
--  ITAMLS DB WIPE — leaves only the admin user + reference data
--  Run: sudo docker compose --env-file .env.prod -f docker-compose.prod.yml \
--          exec -T postgres psql -U itamls -d itamls -f - < apps/api/prisma/wipe.sql
--
--  Or copy the file in and exec it:
--    sudo docker cp apps/api/prisma/wipe.sql itamls_postgres:/tmp/wipe.sql
--    sudo docker exec -it itamls_postgres psql -U itamls -d itamls -f /tmp/wipe.sql
--
--  KEEPS:
--    • admin@fashionfusion.local user
--    • Roles + Permissions + RolePermissions
--    • Categories, SKUs, Suppliers, SoftwareTitles
--    • StoreTemplate + StoreTemplateItem
--    • TonerType
--    • MikrotikNetworkPool (your last-octet allocation state)
--    • Department
--    • HEAD_OFFICE + STOCK_ROOM Locations
--
--  NUKES: everything else — assets, stores, users, GRVs, IBTs,
--  dispatches, POs, PRs, repairs, invoices, audits, alerts,
--  toner plans/orders, backups, discovery reports, api keys,
--  enrollment tokens, PIN pads, mikrotik configs, activity log,
--  helpdesk links, decommissions, depreciation runs.
-- ============================================================

BEGIN;

-- Everything happens in one transaction so a failure rolls back cleanly.

-- ---- Ephemeral / logs ----
DELETE FROM "AuditEvent";
DELETE FROM "Alert";
DELETE FROM "HelpdeskLink";

-- ---- Backups + agent data ----
DELETE FROM "BackupRun";
DELETE FROM "PcSoftwareEntry";
-- Clear API key back-refs on PCs so we can delete without FK grief
UPDATE "StorePc" SET "apiKeyId" = NULL;
DELETE FROM "StorePc";
DELETE FROM "BackupJob";
DELETE FROM "EnrollmentToken";

-- ---- Verifone PIN pads (Nedbank) ----
DELETE FROM "PinPadEvent";
DELETE FROM "PinPad";

-- ---- Procurement / logistics ----
DELETE FROM "PurchaseRequestLine";
DELETE FROM "PurchaseRequest";
DELETE FROM "PurchaseOrder";
DELETE FROM "GrvLine";
DELETE FROM "Grv";
DELETE FROM "IbtLine";
DELETE FROM "Ibt";
DELETE FROM "Dispatch";

-- ---- Service ----
DELETE FROM "Repair";
DELETE FROM "Decommission";
DELETE FROM "Invoice";

-- ---- Audits ----
DELETE FROM "AuditLine";
DELETE FROM "Audit";

-- ---- Software (keep the Titles catalogue) ----
DELETE FROM "SoftwareAssignment";
DELETE FROM "SoftwareLicense";

-- ---- Toner (planning + orders, keep TonerType catalogue) ----
DELETE FROM "TonerOrderLine";
DELETE FROM "TonerOrder";
DELETE FROM "TonerPlan";

-- ---- Assets + inventory movement ----
DELETE FROM "AssetHistory";
DELETE FROM "StockMovement";
DELETE FROM "Stock";
DELETE FROM "Asset";

-- ---- Discovery + Mikrotik generated data ----
DELETE FROM "DiscoveryReport";
DELETE FROM "MikrotikConfig";

-- ---- API keys ----
DELETE FROM "ApiKey";

-- ---- Depreciation history ----
DELETE FROM "DepreciationRun";

-- ---- Stores + their STORE-type Locations ----
DELETE FROM "Store";
DELETE FROM "Location" WHERE type = 'STORE';

-- ---- Users (keep only admin) ----
--  Unlink admin from any (now-deleted) store
UPDATE "User" SET "storeId" = NULL WHERE email = 'admin@fashionfusion.local';
--  Clear per-user permission overrides on other users
DELETE FROM "UserPermissionOverride"
  WHERE "userId" IN (SELECT id FROM "User" WHERE email <> 'admin@fashionfusion.local');
DELETE FROM "User" WHERE email <> 'admin@fashionfusion.local';

-- Sanity check — abort if admin got wiped
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "User" WHERE email = 'admin@fashionfusion.local') THEN
        RAISE EXCEPTION 'admin@fashionfusion.local not found — aborting wipe';
    END IF;
END $$;

COMMIT;

-- ---- Show what's left ----
SELECT 'users'              AS table, COUNT(*) FROM "User"
UNION ALL SELECT 'stores',              COUNT(*) FROM "Store"
UNION ALL SELECT 'assets',              COUNT(*) FROM "Asset"
UNION ALL SELECT 'roles',               COUNT(*) FROM "Role"
UNION ALL SELECT 'permissions',         COUNT(*) FROM "Permission"
UNION ALL SELECT 'categories',          COUNT(*) FROM "Category"
UNION ALL SELECT 'skus',                COUNT(*) FROM "Sku"
UNION ALL SELECT 'suppliers',           COUNT(*) FROM "Supplier"
UNION ALL SELECT 'store_templates',     COUNT(*) FROM "StoreTemplate"
UNION ALL SELECT 'toner_types',         COUNT(*) FROM "TonerType"
UNION ALL SELECT 'mikrotik_pools',      COUNT(*) FROM "MikrotikNetworkPool"
UNION ALL SELECT 'departments',         COUNT(*) FROM "Department"
UNION ALL SELECT 'locations',           COUNT(*) FROM "Location";
