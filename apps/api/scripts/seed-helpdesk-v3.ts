/**
 * One-shot seed for Helpdesk v3 — ticket categories built from the analysis
 * of 5,000 legacy ME tickets, plus KB stub articles for the top deflection
 * opportunities.
 *
 * Run inside the API container:
 *   npx ts-node /app/apps/api/scripts/seed-helpdesk-v3.ts
 *
 * Idempotent: upserts by code so re-running updates existing rows rather than
 * duplicating. Issue templates are deliberately prescriptive (checklist-style)
 * so the "What's the problem?" box forces stores to supply useful detail
 * instead of typing "printer" and bouncing it back to the queue.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

type Cat = {
  code: string;
  name: string;
  description: string;
  defaultPriority: 'P1' | 'P2' | 'P3' | 'P4';
  preferredSkill?: string;
  issueTemplate: string;
  sortOrder: number;
};

const CATEGORIES: Cat[] = [
  // ========== POS & DOLFIN ==========
  {
    code: 'DOLFIN-SALES',
    name: 'Dolfin — sales not updating',
    description: '#1 historical issue (667 of 5000). Dolfin stops syncing sales to HQ.',
    defaultPriority: 'P2',
    preferredSkill: 'DOLFIN',
    sortOrder: 10,
    issueTemplate:
`Last successful Dolfin update time (check the Dolfin tray icon):
Till numbers affected (e.g. all tills / only Till 2):
Is the internet working on the back-office PC? Y/N:
Have you tried: restart Dolfin service / restart back-office PC? Y/N: `,
  },
  {
    code: 'POS-TILL-DOWN',
    name: 'Till / POS not working',
    description: 'Specific till is dead, frozen, or showing errors.',
    defaultPriority: 'P1',
    preferredSkill: 'POS',
    sortOrder: 20,
    issueTemplate:
`Which till number (1 / 2 / 3 / 4):
Error message on screen (please attach a photo):
Can the other tills take sales? Y/N:
When did it start:
Have you restarted the till? Y/N: `,
  },
  {
    code: 'POS-TILL-SLOW',
    name: 'Till frozen / very slow',
    description: 'Till responds but is unusable due to lag.',
    defaultPriority: 'P2',
    preferredSkill: 'POS',
    sortOrder: 30,
    issueTemplate:
`Till number:
When did it start:
Does restart help temporarily? Y/N:
Only during specific actions (login / payment / print)? `,
  },
  {
    code: 'POS-LOGIN',
    name: 'Login / password / cashier login',
    description: 'User can\'t log into till or Dolfin.',
    defaultPriority: 'P3',
    preferredSkill: 'POS',
    sortOrder: 40,
    issueTemplate:
`User name trying to log in:
Error message (please attach photo):
Does it affect everyone or just one user? `,
  },
  {
    code: 'POS-CASHIER-CODE',
    name: 'Cashier code request (new / forgotten)',
    description: '217 of 5000 historical. Often a workflow request, not a fault. See KB "Cashier code request process".',
    defaultPriority: 'P4',
    preferredSkill: 'POS',
    sortOrder: 50,
    issueTemplate:
`Cashier name:
Employee number:
Reason for the new code (new hire / forgot / disabled):
Store manager who authorised the request: `,
  },
  {
    code: 'POS-MANAGER-OVERRIDE',
    name: 'Manager override / authorisation code',
    description: 'Request an override code for a specific transaction.',
    defaultPriority: 'P3',
    preferredSkill: 'POS',
    sortOrder: 60,
    issueTemplate:
`Transaction type (refund / price change / void / discount):
Till number:
Transaction amount: R
Reason the override is needed: `,
  },

  // ========== PRINTERS (LABEL / SLIP / A4) ==========
  {
    code: 'PR-ZEBRA-LABEL',
    name: 'Zebra label printer — not printing',
    description: 'Price label / barcode label printer offline.',
    defaultPriority: 'P2',
    preferredSkill: 'PRINTER',
    sortOrder: 70,
    issueTemplate:
`Till / location of the printer:
Lights on the printer (steady / blinking / off):
Is the label roll empty? Y/N:
Is the ribbon loaded correctly? Y/N: `,
  },
  {
    code: 'PR-ZEBRA-ALIGN',
    name: 'Zebra label printer — labels crooked / cut off',
    description: 'Labels print but wrong size/position.',
    defaultPriority: 'P3',
    preferredSkill: 'PRINTER',
    sortOrder: 80,
    issueTemplate:
`Please attach a photo of the misaligned label.
Label size you are using:
When did it last work correctly: `,
  },
  {
    code: 'PR-SLIP',
    name: 'Slip (receipt) printer — not printing',
    description: 'Receipt printer at till not working.',
    defaultPriority: 'P2',
    preferredSkill: 'PRINTER',
    sortOrder: 90,
    issueTemplate:
`Till number:
Lights on the printer (steady / blinking / off):
Is the paper roll loaded (shiny side out)? Y/N:
Does the till show an error? `,
  },
  {
    code: 'PR-OFFICE-JAM',
    name: 'Office printer — paper jam',
    description: 'HP / Canon office printer jammed.',
    defaultPriority: 'P3',
    preferredSkill: 'PRINTER',
    sortOrder: 100,
    issueTemplate:
`Printer model / name:
Where is the jam (tray / fuser / output):
Have you tried removing the paper? Y/N`,
  },
  {
    code: 'PR-OFFICE-NOT-PRINTING',
    name: 'Office printer — not printing / offline',
    description: 'Printer status shows offline on the PC.',
    defaultPriority: 'P3',
    preferredSkill: 'PRINTER',
    sortOrder: 110,
    issueTemplate:
`Printer name on the PC:
Can other PCs print to it? Y/N:
Error message when printing:
Have you restarted the printer? Y/N`,
  },
  {
    code: 'PR-TONER',
    name: 'Office printer — toner / ink low',
    description: 'Toner request. Routed to Toner Orders — not IT.',
    defaultPriority: 'P4',
    preferredSkill: 'PRINTER',
    sortOrder: 120,
    issueTemplate:
`Printer model:
Toner code (printed on the cartridge, e.g. HP 85A, Canon 737):
Urgency (<24h / <3d / planned): `,
  },

  // ========== PIN PAD / CARD ==========
  {
    code: 'PIN-PAD-OFFLINE',
    name: 'PIN pad — not connecting to till',
    description: 'Card machine stays "disconnected" from the till.',
    defaultPriority: 'P1',
    preferredSkill: 'PIN_PAD',
    sortOrder: 130,
    issueTemplate:
`Till number:
PIN pad serial (sticker on the back):
Is the PIN pad power light on? Y/N:
Error on the till screen: `,
  },
  {
    code: 'PIN-PAD-DECLINE',
    name: 'PIN pad — declining / not reading cards',
    description: 'Card machine on but cards fail.',
    defaultPriority: 'P2',
    preferredSkill: 'PIN_PAD',
    sortOrder: 140,
    issueTemplate:
`Error on PIN pad screen:
Does it fail on all cards or specific ones?
Have you tested with a known-good card? Y/N`,
  },
  {
    code: 'PIN-PAD-SWAP',
    name: 'PIN pad — swap request (unit broken)',
    description: 'Request a replacement PIN pad from Nedbank.',
    defaultPriority: 'P2',
    preferredSkill: 'PIN_PAD',
    sortOrder: 150,
    issueTemplate:
`Till number:
Serial of the broken unit:
Physical fault (cracked screen / cable broken / dead):
Nedbank already notified? Y/N`,
  },

  // ========== NETWORK ==========
  {
    code: 'NET-STORE-DOWN',
    name: 'Internet down — entire store',
    description: 'Nothing works online. Covers 358 of 5000.',
    defaultPriority: 'P1',
    preferredSkill: 'NETWORK',
    sortOrder: 160,
    issueTemplate:
`MikroTik router power light (on / off / blinking):
ISP SMS or outage notice received? Y/N:
Does WiFi work for your phone when connected to the store SSID? Y/N:
Have you restarted the router (unplug 30 sec, plug back)? Y/N: `,
  },
  {
    code: 'NET-SLOW',
    name: 'Internet slow — all tills affected',
    description: 'Online but unusable.',
    defaultPriority: 'P2',
    preferredSkill: 'NETWORK',
    sortOrder: 170,
    issueTemplate:
`Approx when it started:
Is Dolfin updating or stuck?
Are PIN pads timing out? Y/N:
Any ISP SMS notice? `,
  },
  {
    code: 'NET-WIFI',
    name: 'WiFi only — devices can\'t connect',
    description: 'Router is fine but WiFi devices fail.',
    defaultPriority: 'P3',
    preferredSkill: 'NETWORK',
    sortOrder: 180,
    issueTemplate:
`Devices failing (tablet / phone / till):
SSID name:
Error message when connecting: `,
  },

  // ========== DAY END / BANKING ==========
  {
    code: 'EOD-CLOSE',
    name: 'End of day — can\'t close',
    description: '184 of 5000. EOD process fails.',
    defaultPriority: 'P2',
    preferredSkill: 'POS',
    sortOrder: 190,
    issueTemplate:
`Till number:
Error on screen (please attach photo):
Date/time of the last SUCCESSFUL close:
Dolfin updating? Y/N`,
  },
  {
    code: 'EOD-CASH-ONLINE',
    name: 'Cash Online — missing / wrong deposit',
    description: 'Banking reconciliation discrepancy.',
    defaultPriority: 'P3',
    preferredSkill: 'POS',
    sortOrder: 200,
    issueTemplate:
`Deposit date:
Amount: R
Reference number from the bank:
Expected amount vs actual: `,
  },
  {
    code: 'EOD-IBT-BOX',
    name: 'Stock transfer / box receive error',
    description: 'IBT / box receive refuses to complete.',
    defaultPriority: 'P3',
    preferredSkill: 'POS',
    sortOrder: 210,
    issueTemplate:
`IBT number / Box number:
Error message:
From store:
To store: `,
  },

  // ========== SIGNAGE ==========
  {
    code: 'SIG-BLACK',
    name: 'Media player — screen black / nothing playing',
    description: 'Signage TV showing nothing.',
    defaultPriority: 'P3',
    preferredSkill: 'SIGNAGE',
    sortOrder: 220,
    issueTemplate:
`TV mounted landscape or portrait:
Media player power light (on / off / blinking):
Has the TV ever worked at this store? Y/N`,
  },
  {
    code: 'SIG-WRONG',
    name: 'Media player — wrong video playing',
    description: 'Something is playing, but not the correct campaign.',
    defaultPriority: 'P4',
    preferredSkill: 'SIGNAGE',
    sortOrder: 230,
    issueTemplate:
`What is currently playing:
What should be playing:
Brand (Fashion Fusion / Evolve): `,
  },

  // ========== CCTV ==========
  {
    code: 'CCTV-DVR',
    name: 'DVR offline / no live feed',
    description: '38 of 5000. CCTV box dead.',
    defaultPriority: 'P2',
    preferredSkill: 'CCTV',
    sortOrder: 240,
    issueTemplate:
`DVR power light status:
Monitor connected directly to DVR? Y/N:
Has the DVR been powered off recently? Y/N`,
  },
  {
    code: 'CCTV-CAM',
    name: 'Camera black / no image on one channel',
    description: 'One camera channel is dead.',
    defaultPriority: 'P3',
    preferredSkill: 'CCTV',
    sortOrder: 250,
    issueTemplate:
`Camera number (channel #):
Position in store:
Is the DVR itself up and recording other channels? Y/N`,
  },

  // ========== MISC ==========
  {
    code: 'EMAIL-OUTLOOK',
    name: 'Email / Outlook — can\'t send or receive',
    description: 'Standard Outlook problem.',
    defaultPriority: 'P3',
    preferredSkill: 'POS',
    sortOrder: 260,
    issueTemplate:
`User email address:
Error message (please attach photo):
Can you log into webmail (outlook.office.com)? Y/N`,
  },
  {
    code: 'HW-REPLACE',
    name: 'Hardware replacement request',
    description: 'Equipment needs physical swap.',
    defaultPriority: 'P3',
    preferredSkill: 'POS',
    sortOrder: 270,
    issueTemplate:
`What needs replacing (PC / monitor / scanner / etc.):
Serial of the old unit:
Is the unit under warranty? (check sticker)`,
  },
  {
    code: 'BARCODE-SCAN',
    name: 'Barcode scanner — not scanning',
    description: '90 of 5000. Zebra scanner on till not reading.',
    defaultPriority: 'P2',
    preferredSkill: 'POS',
    sortOrder: 280,
    issueTemplate:
`Till number:
Does the laser come on when you pull the trigger? Y/N:
Does it beep on some products but not others?
Have you tested with a known-good barcode? Y/N`,
  },
  {
    code: 'OTHER',
    name: 'Other — please describe',
    description: 'Last-resort category. Pick a specific one above if possible.',
    defaultPriority: 'P3',
    sortOrder: 999,
    issueTemplate:
`Please describe the problem in detail:
- What's broken:
- When it started:
- Who / which till / which device is affected:
- What have you tried so far: `,
  },
];

// ============================================================
//  Knowledge Base articles — top deflection opportunities
// ============================================================
const KB: Array<{ slug: string; title: string; tags: string; body: string; categoryCode?: string }> = [
  {
    slug: 'cashier-code-request',
    title: 'How to request a cashier code (new or forgotten)',
    tags: 'cashier, code, login, hr',
    categoryCode: 'POS-CASHIER-CODE',
    body: `# Cashier code request

You do NOT need to log an IT ticket for a cashier code — IT does not create or reset cashier codes.

## For a NEW cashier
1. The store manager emails HR with the new employee details (name, ID number, start date).
2. HR issues an employee number and sends it back within 24h.
3. The employee number IS the cashier code.

## Forgotten code
1. Store manager checks the cashier roster — the code is on the HR confirmation email.
2. If still missing, email HR directly — not IT.

Only log an IT ticket if the till rejects a code that HR confirms is correct.`,
  },
  {
    slug: 'dolfin-sales-not-updating-quick-fix',
    title: 'Dolfin — "sales not updating" — try these 3 things before logging a ticket',
    tags: 'dolfin, sales, sync, pos',
    categoryCode: 'DOLFIN-SALES',
    body: `# "Sales not updating on Dolfin"

The #1 helpdesk issue. In ~40% of cases these 3 fixes solve it immediately:

## 1. Check the internet
Open a browser on the back-office PC. Try to open **https://www.google.com**.
- If it won't load → log an **Internet down** ticket instead.
- If it loads but is very slow → log **Internet slow**.

## 2. Restart the Dolfin service
On the back-office PC:
1. Right-click the Dolfin icon in the system tray (bottom-right).
2. Click **Stop service**, wait 10 seconds, click **Start service**.
3. Wait 2 minutes, check if the "Last update" time changes.

## 3. Restart the back-office PC
Full shutdown, 30 seconds, power back on. Wait 3 minutes for Dolfin to come up.

## Still broken?
Log a ticket under **Dolfin — sales not updating** with:
- Last successful update time
- Till numbers affected
- Whether the internet is working`,
  },
  {
    slug: 'zebra-label-roll-swap',
    title: 'How to replace a Zebra label roll',
    tags: 'zebra, label, printer, roll',
    categoryCode: 'PR-ZEBRA-LABEL',
    body: `# Replace a Zebra label roll

## You need
- A new label roll (same width as the old one)
- Nothing else — the printer handles the rest

## Steps
1. Open the printer by sliding the two **green latches** on either side up/outwards.
2. Lift out the empty core.
3. Place the new roll on the spindle — **labels facing up, feeding out towards the printer head**.
4. Pull about 20cm of label out and lay it over the black roller.
5. Close the lid firmly until it clicks.
6. Press the **feed** button once. The printer will auto-calibrate.

## If labels print crooked after swap
- The ribbon loaded wrong (shiny side wrong way). Open the printer and flip the ribbon.
- Log an **"Zebra labels crooked / cut off"** ticket if that doesn't fix it.`,
  },
  {
    slug: 'slip-printer-paper-reload',
    title: 'How to reload slip-printer paper',
    tags: 'slip, receipt, printer, paper, epson',
    categoryCode: 'PR-SLIP',
    body: `# Reload the slip (receipt) printer

## Steps
1. Open the top of the printer by pressing the small button on the right side.
2. Drop in the new roll — **shiny side facing you** (towards the till).
3. Pull about 10cm of paper out, close the lid firmly.
4. The printer cuts the extra paper automatically.

## If it still won't print
- Check the lights on the top: a **flashing red** usually means the lid isn't closed properly.
- If no lights at all → power problem, log an **"Slip printer not printing"** ticket.`,
  },
  {
    slug: 'pin-pad-cards-declining',
    title: 'PIN pad declining cards — try these 3 things first',
    tags: 'pin, pad, card, decline, nedbank',
    categoryCode: 'PIN-PAD-DECLINE',
    body: `# PIN pad declining cards

## 1. Test with a known-good card
- Try a card you've just tested somewhere else that works.
- If YOUR card is also declined on the shop's PIN pad → the PIN pad is the problem.
- If YOUR card works → the customer's card may be the issue (ask them to contact their bank).

## 2. Restart the PIN pad
- Unplug the PIN pad's power cable from the back of the till.
- Wait 30 seconds.
- Plug back in. Wait 2 minutes for it to boot and connect.

## 3. Check till ↔ PIN pad connection
- Look for a "disconnected" or "no card reader" message on the till screen.
- If disconnected → log a **"PIN pad not connecting"** ticket.

## When to call Nedbank directly
If the PIN pad screen shows "FAULT" or "CALL BANK" or "DEVICE LOCKED":
- Call Nedbank Device Support: **0860 555 111**
- Give them the PIN pad serial (sticker on the back).
- Log an IT ticket AFTER you've spoken to them, with the Nedbank ref number.`,
  },
  {
    slug: 'eod-common-errors',
    title: 'End of Day — common errors and fixes',
    tags: 'eod, day end, closing, banking, cash online',
    categoryCode: 'EOD-CLOSE',
    body: `# End-of-Day common errors

## Error: "Previous day not closed"
- You missed yesterday's close. Close yesterday's trade first, then today's.
- Access the Close screen → scroll back to find the oldest open day.

## Error: "Till figures do not match"
- A till wasn't closed before you ran the EOD. Go into each till and close it individually first.

## Error: "Sales not uploaded"
- Dolfin hasn't synced yet. Wait 10 minutes, try again.
- If still failing after 15 minutes → see "Dolfin — sales not updating" KB article.

## Error: "Cash Online rejection — amount mismatch"
- Recount the cash physically.
- Common cause: a float transfer was missed. Check your float journal.

## When to log a ticket
Only log an **End of day — can't close** ticket if:
- You get an error not listed above, OR
- You've tried the fixes above and it still fails.`,
  },
];

// ============================================================
async function main() {
  console.log('Seeding Helpdesk v3 categories…');

  for (const c of CATEGORIES) {
    await prisma.ticketCategory.upsert({
      where: { code: c.code },
      update: {
        name: c.name,
        description: c.description,
        defaultPriority: c.defaultPriority,
        preferredSkill: c.preferredSkill ?? null,
        issueTemplate: c.issueTemplate,
        sortOrder: c.sortOrder,
        isActive: true,
      },
      create: {
        code: c.code,
        name: c.name,
        description: c.description,
        defaultPriority: c.defaultPriority,
        preferredSkill: c.preferredSkill ?? null,
        issueTemplate: c.issueTemplate,
        sortOrder: c.sortOrder,
        isActive: true,
      },
    });
    console.log(`  ✓ ${c.code.padEnd(22)} ${c.name}`);
  }

  console.log('\nSeeding KB stub articles…');
  for (const a of KB) {
    const category = a.categoryCode
      ? await prisma.ticketCategory.findUnique({ where: { code: a.categoryCode } })
      : null;
    await prisma.kbArticle.upsert({
      where: { slug: a.slug },
      update: {
        title: a.title, body: a.body, tags: a.tags,
        categoryId: category?.id ?? null, isPublished: true,
      },
      create: {
        slug: a.slug, title: a.title, body: a.body, tags: a.tags,
        categoryId: category?.id ?? null, isPublished: true,
      },
    });
    console.log(`  ✓ ${a.slug.padEnd(40)} ${a.title}`);
  }

  console.log(`\nDone. ${CATEGORIES.length} categories, ${KB.length} KB articles.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
