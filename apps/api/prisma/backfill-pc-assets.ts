/**
 * One-off backfill: for every StorePc that was enrolled BEFORE the
 * auto-Asset-creation logic was added, create the matching Asset row
 * so it shows up on HQ Assets / StoreDetail.
 *
 * Safe to re-run — skips any PC that already has an assetId.
 *
 * Run:
 *   docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T api \
 *     sh -c 'cd /app/apps/api && node_modules/.bin/ts-node prisma/backfill-pc-assets.ts'
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  const fallbackSku = await prisma.sku.findUnique({ where: { code: 'AUTO-DISC-PC' } });
  if (!fallbackSku) {
    console.error('Missing AUTO-DISC-PC SKU. Run `prisma/seed.ts` first.');
    process.exit(1);
  }

  const pcs = await prisma.storePc.findMany({ where: { assetId: null } });
  console.log(`Backfilling ${pcs.length} PC(s) without a linked Asset...`);

  let created = 0, linked = 0;
  for (const pc of pcs) {
    // 1) If an Asset already exists with the same hostname, just link it
    const existing = await prisma.asset.findFirst({ where: { hostname: pc.name } });
    if (existing) {
      await prisma.storePc.update({ where: { id: pc.id }, data: { assetId: existing.id } });
      linked++;
      continue;
    }

    // 2) Otherwise create one
    let locationId: string | null = null;
    if (pc.storeId) {
      const s = await prisma.store.findUnique({ where: { id: pc.storeId }, select: { locationId: true } });
      locationId = s?.locationId ?? null;
    } else {
      const ho = await prisma.location.findFirst({ where: { type: 'HEAD_OFFICE' }, select: { id: true } });
      locationId = ho?.id ?? null;
    }

    let assetTag = `AUTO-${pc.name}`.toUpperCase().replace(/[^A-Z0-9-]/g, '-').slice(0, 60);
    const dupe = await prisma.asset.findUnique({ where: { assetTag } });
    if (dupe) assetTag = `${assetTag}-${randomBytes(2).toString('hex').toUpperCase()}`;

    const asset = await prisma.asset.create({
      data: {
        assetTag,
        skuId: fallbackSku.id,
        hostname: pc.name,
        osVersion: pc.osVersion ?? undefined,
        cpuModel: pc.cpuModel ?? undefined,
        ramGb: pc.ramGb ?? undefined,
        lastSeenAt: pc.lastSeenAt ?? new Date(),
        locationId, source: 'AGENT',
        status: 'IN_STORE',
        assignedStoreId: pc.storeId ?? undefined,
        assignedDepartmentId: pc.departmentId ?? undefined,
        condition: 'GOOD',
      },
    });
    await prisma.assetHistory.create({
      data: {
        assetId: asset.id, eventType: 'AUTO_DISCOVERED',
        toLocationId: locationId ?? undefined,
        notes: `Backfilled from PC agent (scope=${pc.scope}, name=${pc.name})`,
      },
    });
    await prisma.storePc.update({ where: { id: pc.id }, data: { assetId: asset.id } });
    created++;
    console.log(`  + ${pc.name} -> ${assetTag}`);
  }

  console.log(`Done. ${created} Asset(s) created, ${linked} PC(s) linked to existing Assets.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
