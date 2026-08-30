/**
 * One-off store import — creates the 85 Fashion Fusion + Evolve stores
 * supplied by the user. Idempotent (skips codes that already exist).
 *
 * Run:
 *   docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T api \
 *     sh -c 'cd /app/apps/api && node_modules/.bin/ts-node prisma/import-stores.ts'
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Row = { name: string; region: string; code: string };

// Evolve stores (entity = EVLV) — split from FF by name prefix
const RAW: Row[] = [
  { code: 'FFN0101', name: '501 West Street',             region: 'KZN' },
  { code: 'FFN0166', name: '85 on Field',                 region: 'KZN' },
  { code: 'FFN0186', name: 'Bellville CBD',               region: 'Western Cape' },
  { code: 'FFN0191', name: 'Bethal',                      region: 'Mpumalanga' },
  { code: 'FFN0210', name: 'Blm Plaza',                   region: 'Free State' },
  { code: 'FFN0122', name: 'Bloemfontein',                region: 'Free State' },
  { code: 'FFN0163', name: 'Boardwalk',                   region: 'KZN' },
  { code: 'FFN0202', name: 'Boksburg',                    region: 'Gauteng' },
  { code: 'FFN0192', name: 'Buchanan Chambers',           region: 'Western Cape' },
  { code: 'FFN0151', name: 'Burgesfort',                  region: 'Limpopo' },
  { code: 'FFN0179', name: 'Cape Town CBD',               region: 'Western Cape' },
  { code: 'FFN0197', name: 'Central Park Bloem',          region: 'Free State' },
  { code: 'FFN0169', name: 'Chatsworth',                  region: 'KZN' },
  { code: 'FFN0189', name: 'Chris Hani Crossing',         region: 'Gauteng' },
  { code: 'FFN0115', name: 'Church Street - PMB',         region: 'KZN' },
  { code: 'FFN0187', name: 'Circus Triangle',             region: 'Eastern Cape' },
  { code: 'FFN0213', name: 'Cresta',                      region: 'Gauteng' },
  { code: 'FFN0174', name: 'East Rand Mall',              region: 'Gauteng' },
  { code: 'FFN0218', name: 'Eloff Street',                region: 'Gauteng' },
  { code: 'FFN0217', name: 'Empangeni',                   region: 'KZN' },
  { code: 'FFN0194', name: 'Ermelo',                      region: 'Mpumalanga' },
  { code: 'FFN0214', name: 'Festival Mall',               region: 'Gauteng' },
  { code: 'FFN0119', name: 'Fusion Man',                  region: 'KZN' },
  { code: 'FFN0161', name: 'Galleria Mall',               region: 'KZN' },
  { code: 'FFN0137', name: 'Greenacres - P.E',            region: 'Eastern Cape' },
  { code: 'FFN0170', name: 'Hillcrest',                   region: 'KZN' },
  { code: 'FFN0135', name: 'Kagiso - JHB',                region: 'Gauteng' },
  { code: 'FFN0152', name: 'King Williams Town',          region: 'Eastern Cape' },
  { code: 'FFN0149', name: 'Kokstad CBD',                 region: 'KZN' },
  { code: 'FFN0150', name: 'Ladysmith CBD',               region: 'KZN' },
  { code: 'FFN0211', name: 'Lakeside',                    region: 'Gauteng' },
  { code: 'FFN0165', name: 'Lister',                      region: 'Gauteng' },
  { code: 'FFN0158', name: 'Lowveld',                     region: 'Mpumalanga' },
  { code: 'FFN0206', name: 'Madeira Street - Mthatha CBD',region: 'Eastern Cape' },
  { code: 'FFN0195', name: 'Mall of Gateway',             region: 'KZN' },
  { code: 'FFN0190', name: 'Mall of Tembisa',             region: 'Gauteng' },
  { code: 'FFN0182', name: 'Mamelodi',                    region: 'Gauteng' },
  { code: 'FFN0200', name: 'Maponya Mall',                region: 'Gauteng' },
  { code: 'FFN0131', name: 'Markade',                     region: 'Gauteng' },
  { code: 'FFN0123', name: 'Matatiele',                   region: 'Eastern Cape' },
  { code: 'FFN0144', name: 'Mthatha Plaza',               region: 'Eastern Cape' },
  { code: 'FFN0113', name: 'Newcastle - Harding Street',  region: 'KZN' },
  { code: 'FFN0188', name: 'Newtown Junction',            region: 'Gauteng' },
  { code: 'FFN0130', name: 'Oxford Street - East London', region: 'Eastern Cape' },
  { code: 'FFN0204', name: 'Pan Africa Mall - Alex',      region: 'Gauteng' },
  { code: 'FFN0168', name: 'Phoenix Plaza',               region: 'KZN' },
  { code: 'FFN0110', name: 'Pinewalk Centre',             region: 'KZN' },
  { code: 'FFN0196', name: 'PMB CBD',                     region: 'KZN' },
  { code: 'FFN0153', name: 'Polokwane (CBD)',             region: 'Limpopo' },
  { code: 'FFN0116', name: 'Port Shepstone',              region: 'KZN' },
  { code: 'FFN0212', name: 'President Hyper Vaal - FF',   region: 'Gauteng' },
  { code: 'FFN0172', name: 'Pretoria Queen',              region: 'Gauteng' },
  { code: 'FFN0205', name: 'Princess Mkabayi Mall - Vryheid', region: 'KZN' },
  { code: 'FFN0147', name: 'Promonade Mall',              region: 'Mpumalanga' },
  { code: 'FFN0127', name: 'Queenstown',                  region: 'Eastern Cape' },
  { code: 'FFN0181', name: 'Secunda',                     region: 'Mpumalanga' },
  { code: 'FFN0215', name: 'Soshanguve',                  region: 'Gauteng' },
  { code: 'FFN0175', name: 'Southgate Mall',              region: 'Gauteng' },
  { code: 'FFN0105', name: 'Southway Mall',               region: 'KZN' },
  { code: 'FFN0133', name: 'Soweto - Bara Precinct',      region: 'Gauteng' },
  { code: 'FFN0106', name: 'Stamford Hill',               region: 'KZN' },
  { code: 'FFN0148', name: 'Stanger CBD',                 region: 'KZN' },
  { code: 'FFN0203', name: 'Taxi Centre (Polokwane)',     region: 'Limpopo' },
  { code: 'FFN0134', name: 'Thembisa - JHB',              region: 'Gauteng' },
  { code: 'FFN0177', name: 'Thoyandou CBD',               region: 'Limpopo' },
  { code: 'FFN0201', name: 'Town Square Alberton',        region: 'Gauteng' },
  { code: 'FFN0132', name: 'Tramshed',                    region: 'Gauteng' },
  { code: 'FFN0146', name: 'Ulundi',                      region: 'KZN' },
  { code: 'FFN0156', name: 'Umlazi Mega City',            region: 'KZN' },
  { code: 'FFN0112', name: 'Verulam - Wick Street',       region: 'KZN' },
  { code: 'FFN0183', name: 'Victoria Road Cape Town',     region: 'Western Cape' },
  { code: 'FFN0164', name: 'Vincent Park',                region: 'Eastern Cape' },
  { code: 'FFN0157', name: 'Vryheid CBD',                 region: 'KZN' },
  { code: 'FFN0209', name: 'Westgate',                    region: 'Gauteng' },
  { code: 'FFN0141', name: 'Woodmead - JHB',              region: 'Gauteng' },
  { code: 'FFN0178', name: 'Wynberg',                     region: 'Western Cape' },
  { code: 'FFN0219', name: 'Wonderpark Mall',             region: 'Gauteng' },
  { code: 'FFN0223', name: 'Bridge City Mall',            region: 'KZN' },

  // Evolve (entity = EVLV) — names begin with "Evolve" / "Evovle" (typo pass-through)
  { code: 'FFN2003', name: 'Evolve Carlton',              region: 'Gauteng' },
  { code: 'FFN2009', name: 'Evolve Boardwalk',            region: 'KZN' },
  { code: 'FFN2010', name: 'Evolve Field Street',         region: 'KZN' },
  { code: 'FFN2006', name: 'Evolve Galleria',             region: 'KZN' },
  { code: 'FFN2012', name: 'Evolve PMB CBD',              region: 'KZN' },
  { code: 'FFN2007', name: 'Evolve Promenade Mall',       region: 'Mpumalanga' },
  { code: 'FFN2011', name: 'Evolve Sammy Marks',          region: 'Gauteng' },
  { code: 'FFN2008', name: 'Evolve Sohanguwe',            region: 'Gauteng' },
  { code: 'FFN2002', name: 'Evolve Workshop',             region: 'KZN' },
];

async function main() {
  const openedAt = new Date();
  let created = 0, skipped = 0, failed = 0;

  for (const row of RAW) {
    const code = row.code.trim().toUpperCase();
    const isEvolve = /^evolve|^evovle/i.test(row.name);
    const entity = isEvolve ? 'EVLV' : 'FASHION_FUSION';
    const locCode = `STR-${code}`;

    try {
      const dupe = await prisma.store.findUnique({ where: { code } });
      if (dupe) {
        skipped++;
        console.log(`  = ${code}  ${row.name} (already exists — skipped)`);
        continue;
      }

      const location = await prisma.location.upsert({
        where: { code: locCode },
        create: { code: locCode, name: `Store ${code} - ${row.name}`, type: 'STORE', region: row.region },
        update: { name: `Store ${code} - ${row.name}`, type: 'STORE', region: row.region },
      });
      const store = await prisma.store.create({
        data: {
          code, name: row.name, region: row.region, entity,
          locationId: location.id, status: 'OPEN', openedAt,
        },
      });
      await prisma.backupJob.upsert({
        where: { storeId: store.id },
        create: { storeId: store.id }, update: {},
      });
      created++;
      console.log(`  + ${code}  ${row.name}  [${entity}]  ${row.region}`);
    } catch (e: any) {
      failed++;
      console.log(`  ! ${code}  ${row.name}  FAILED  ${e?.message ?? e}`);
    }
  }

  console.log('');
  console.log(`Done.  created=${created}  skipped=${skipped}  failed=${failed}  total=${RAW.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
