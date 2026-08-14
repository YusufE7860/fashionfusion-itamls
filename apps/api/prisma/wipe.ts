/**
 * DESTRUCTIVE — wipes the DB down to a fresh admin-only state.
 *
 * Keeps:
 *   - admin@fashionfusion.local user
 *   - Roles + Permissions + RolePermissions
 *   - Categories, SKUs, Suppliers
 *   - StoreTemplates + StoreTemplateItems
 *   - TonerTypes
 *   - MikrotikNetworkPools
 *   - HEAD_OFFICE + STOCK_ROOM locations (STORE-type locations are removed
 *     together with their stores)
 *
 * Nukes: every store, every store PC, every asset, every user other than
 * admin, all logistics/GRV/IBT/dispatch/PR/PO/repair/invoice/audit/alert
 * rows, all discovery reports, all api keys, all enrollment tokens, all
 * mikrotik generated configs, all backups, all activity log entries, all
 * helpdesk links, all decommissions, all software licenses/assignments,
 * all depreciation runs.
 *
 * Run:
 *   docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T api \
 *     sh -c 'cd /app/apps/api && node_modules/.bin/ts-node prisma/wipe.ts'
 *
 * Pass CONFIRM=WIPE as an env var to actually run — otherwise it prints
 * what it WOULD delete and exits.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ADMIN_EMAIL = 'admin@fashionfusion.local';

async function count() {
  return {
    users: await prisma.user.count(),
    stores: await prisma.store.count(),
    storePcs: await prisma.storePc.count(),
    assets: await prisma.asset.count(),
    grvs: await prisma.grv.count(),
    ibts: await prisma.ibt.count(),
    dispatches: await prisma.dispatch.count(),
    purchaseRequests: await prisma.purchaseRequest.count(),
    purchaseOrders: await prisma.purchaseOrder.count(),
    repairs: await prisma.repair.count(),
    invoices: await prisma.invoice.count(),
    audits: await prisma.audit.count(),
    alerts: await prisma.alert.count(),
    activityEvents: await prisma.auditEvent.count(),
    apiKeys: await prisma.apiKey.count(),
    enrollmentTokens: await prisma.enrollmentToken.count(),
    mikrotikConfigs: await prisma.mikrotikConfig.count(),
    discoveryReports: await prisma.discoveryReport.count(),
    softwareLicenses: await prisma.softwareLicense.count(),
    tonerPlans: await prisma.tonerPlan.count(),
    tonerOrders: await prisma.tonerOrder.count(),
    locations: await prisma.location.count(),
  };
}

async function main() {
  const dry = process.env.CONFIRM !== 'WIPE';

  console.log('BEFORE:');
  console.table(await count());

  if (dry) {
    console.log('\nDRY RUN — set CONFIRM=WIPE to actually delete.');
    return;
  }

  console.log('\nWiping...');

  // Order matters — delete children before parents. Prisma raises on FK
  // violations otherwise. Cascades cover most of it but we're explicit for
  // safety and to preserve a couple of parent rows.

  // --- ephemeral / logs first ---
  await prisma.auditEvent.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.helpdeskLink.deleteMany();

  // --- backups + PC-agent data ---
  await prisma.backupRun.deleteMany();
  await prisma.pcSoftwareEntry.deleteMany();
  await prisma.storePc.deleteMany();
  await prisma.backupJob.deleteMany();
  await prisma.enrollmentToken.deleteMany();

  // --- procurement / logistics ---
  await prisma.purchaseRequestLine.deleteMany();
  await prisma.purchaseRequest.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.grvLine.deleteMany();
  await prisma.grv.deleteMany();
  await prisma.ibtLine.deleteMany();
  await prisma.ibt.deleteMany();
  await prisma.dispatch.deleteMany();

  // --- service ---
  await prisma.repair.deleteMany();
  await prisma.decommission.deleteMany();
  await prisma.invoice.deleteMany();

  // --- audits ---
  await prisma.auditLine.deleteMany();
  await prisma.audit.deleteMany();

  // --- software licences ---
  await prisma.softwareAssignment.deleteMany();
  await prisma.softwareLicense.deleteMany();
  // Titles are catalog-ish; keep them so admin doesn't have to re-add.

  // --- toner (planning + orders, keep TonerType catalog) ---
  await prisma.tonerOrderLine.deleteMany();
  await prisma.tonerOrder.deleteMany();
  await prisma.tonerPlan.deleteMany();

  // --- assets + inventory movements ---
  await prisma.assetHistory.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.asset.deleteMany();

  // --- discovery + mikrotik generated data ---
  await prisma.discoveryReport.deleteMany();
  await prisma.mikrotikConfig.deleteMany();
  // Keep MikrotikNetworkPool rows — that's the last-octet allocation state.

  // --- api keys (all except things we don't have yet) ---
  await prisma.apiKey.deleteMany();

  // --- depreciation history ---
  await prisma.depreciationRun.deleteMany();

  // --- stores (and their STORE-type locations) ---
  const stores = await prisma.store.findMany({ select: { locationId: true } });
  const storeLocIds = stores.map((s) => s.locationId);
  await prisma.store.deleteMany();
  if (storeLocIds.length) {
    await prisma.location.deleteMany({ where: { id: { in: storeLocIds } } });
  }
  // Any lingering STORE-type location not linked (belt-and-braces)
  await prisma.location.deleteMany({ where: { type: 'STORE' } });

  // --- users (keep only admin) ---
  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    console.error(`\nFATAL: no admin user found at ${ADMIN_EMAIL}. Aborting user wipe — run the seed first to create one, or edit ADMIN_EMAIL in wipe.ts.`);
    process.exit(1);
  }
  // Clear per-user permission overrides on other users first (cascades on delete but explicit is safer)
  await prisma.userPermissionOverride.deleteMany({ where: { userId: { not: admin.id } } });
  // Unlink admin from any store (its store was just deleted)
  await prisma.user.update({ where: { id: admin.id }, data: { storeId: null } });
  await prisma.user.deleteMany({ where: { id: { not: admin.id } } });

  console.log('\nAFTER:');
  console.table(await count());

  console.log('\nDone. Admin login still works — sign in as admin@fashionfusion.local.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
