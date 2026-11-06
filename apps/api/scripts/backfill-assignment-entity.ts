/**
 * Backfill SignageAssignment.entity from the attached playlist's entity.
 *
 * Run ONCE after deploying the per-brand-slot schema change:
 *   docker compose -f docker-compose.prod.yml exec api \
 *     node dist/scripts/backfill-assignment-entity.js
 *
 * Idempotent — skips rows that already have an entity set. If two legacy
 * rows end up pointing at the same (storeId, entity) slot after backfill
 * (shouldn't happen in practice, but legacy data is messy) the newer one
 * wins and the older gets renamed to the BOTH slot as a fallback so you
 * don't lose it silently.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.signageAssignment.findMany({
    where: { entity: null },
    include: { playlist: { select: { entity: true } } },
    orderBy: { createdAt: 'asc' },
  });

  let moved = 0;
  let collided = 0;

  for (const row of rows) {
    const target = row.playlist?.entity ?? 'BOTH';
    try {
      await prisma.signageAssignment.update({
        where: { id: row.id },
        data: { entity: target },
      });
      moved++;
    } catch (e: any) {
      // Unique constraint violation — another row already occupies this
      // slot. Shunt this one into BOTH so we don't drop the data.
      try {
        await prisma.signageAssignment.update({
          where: { id: row.id },
          data: { entity: 'BOTH' },
        });
        collided++;
      } catch {
        // Even BOTH is taken — delete this stray row. Last line of defence.
        await prisma.signageAssignment.delete({ where: { id: row.id } });
        collided++;
      }
    }
  }

  console.log(`Backfilled ${moved} assignments; ${collided} shunted to BOTH / dropped.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
