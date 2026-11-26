/**
 * Backfill signage video orientation.
 *
 * Reads the width/height of each video's largest variant and sets
 *   orientation = 'PORTRAIT'  when height > width
 *   orientation = 'LANDSCAPE' otherwise
 *
 * Skips videos whose orientation was already set to a non-'ANY' value
 * (respect manual overrides from the admin UI).
 *
 * Idempotent - safe to run multiple times.
 *
 * Run inside the API container:
 *   npx ts-node /app/apps/api/scripts/backfill-video-orientation.ts
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const videos = await prisma.signageVideo.findMany({
    where: { orientation: 'ANY' },
    include: {
      variants: { orderBy: { height: 'desc' }, take: 1 },
    },
  });

  console.log(`Found ${videos.length} videos tagged 'ANY' to classify`);

  let portrait = 0, landscape = 0, skipped = 0;
  for (const v of videos) {
    const variant = v.variants[0];
    if (!variant || !variant.width || !variant.height) {
      console.log(`  - ${v.filename}: no variant resolution info -> skip`);
      skipped++;
      continue;
    }
    const orientation = variant.height > variant.width ? 'PORTRAIT' : 'LANDSCAPE';
    await prisma.signageVideo.update({
      where: { id: v.id },
      data: { orientation },
    });
    console.log(`  v ${v.filename.padEnd(50)} ${variant.width}x${variant.height} -> ${orientation}`);
    if (orientation === 'PORTRAIT') portrait++; else landscape++;
  }

  console.log(`\nDone. ${landscape} landscape, ${portrait} portrait, ${skipped} unknown.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); process.exit(1); });
