import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StoresService } from './stores.service';
// pdfkit is a plain Node lib (used elsewhere in this project — see
// helpdesk/exports.service.ts). CJS import keeps TS happy.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

/**
 * New Store Wizard.
 *
 * Operator flow in the UI:
 *   1) Pick a brand (entity)
 *   2) Enter the store name
 *   3) Pick a template (Small / Medium / Large / Flagship / Custom …)
 *      - Non-Custom templates carry a pre-defined equipment list
 *        (StoreTemplateItem.requiredQty per category).
 *      - "Custom" template unlocks manual quantities (POS, offices,
 *        printers, screens) so the operator can design a one-off layout.
 *   4) Review the costed equipment proposal, optionally download a PDF
 *      checklist, and commit — the commit step creates the Location +
 *      Store rows so the new store appears under /stores immediately.
 *
 * A template is treated as "Custom" when its code equals 'CUSTOM' (case
 * insensitive). Nothing in the schema needs to change — this is a
 * naming convention the wizard respects.
 */
const CUSTOM_CODE = 'CUSTOM';

// Category codes we recognise for custom-template quantity mapping. These
// mirror the canonical categories we seed in Admin → Templates. Any custom
// category the operator adds later still works via the template-items path;
// the custom-mode path just needs the common four.
const CUSTOM_CATEGORY_MAP: Record<string, keyof CustomInputs> = {
  'POS_PC':     'posPoints',
  'OFFICE_PC':  'offices',
  'PRINTER':    'printers',
  'MONITOR':    'screens',
};

interface CustomInputs {
  posPoints: number;
  offices:   number;
  printers:  number;
  screens:   number;
}

export class WizardDto {
  @IsString() name!: string;
  @IsIn(['FASHION_FUSION', 'EVLV', 'BOTH']) entity!: 'FASHION_FUSION' | 'EVLV' | 'BOTH';
  @IsString() templateId!: string;
  @IsString() region!: string;

  // Custom-template quantities (ignored when the template isn't Custom).
  @IsOptional() @IsInt() @Min(0) posPoints?: number;
  @IsOptional() @IsInt() @Min(0) offices?:   number;
  @IsOptional() @IsInt() @Min(0) printers?:  number;
  @IsOptional() @IsInt() @Min(0) screens?:   number;

  // Cost overrides (operator can tweak before committing).
  @IsOptional() @IsInt() @Min(0) installationCostCents?: number;
  @IsOptional() @IsInt() @Min(0) travelCostCents?:       number;
  @IsOptional() @IsInt() @Min(0) labourCostCents?:       number;
  @IsOptional() @IsInt() @Min(0) contingencyPct?:        number;

  // commit=true → create the Location + Store rows and return the new store id.
  // commit=false (default) → return the proposal only, create nothing.
  @IsOptional() @IsBoolean() commit?: boolean;
  @IsOptional() @IsString() storeCode?: string;         // skip auto-generation if set
  @IsOptional() @IsEmail()  contactEmail?: string;
  // Metadata fields mirror the "Register an existing store" form so the
  // wizard can set them at creation time instead of forcing a second
  // round-trip through /stores.
  @IsOptional() @IsString() status?: string;            // OPEN | PLANNED | OPENING | REMODEL | CLOSED
  @IsOptional() @IsString() openedAt?: string;          // ISO date
  @IsOptional() @IsString() areaManagerId?: string;
}

@Injectable()
export class WizardService {
  constructor(private prisma: PrismaService, private stores: StoresService) {}

  async run(dto: WizardDto) {
    const proposal = await this.buildProposal(dto);
    if (dto.commit) {
      const created = await this.createStoreFromProposal(dto, proposal);
      return { ...proposal, createdStore: created };
    }
    return proposal;
  }

  /** POST /stores/wizard/pdf — stream a printable equipment checklist. */
  async pdf(dto: WizardDto): Promise<Buffer> {
    const proposal = await this.buildProposal(dto);
    return this.renderPdf(dto, proposal);
  }

  // ---- internals -----------------------------------------------------------

  private async buildProposal(dto: WizardDto) {
    const template = await this.prisma.storeTemplate.findUnique({
      where: { id: dto.templateId },
      include: { items: { include: { category: true } } },
    });
    if (!template) throw new NotFoundException('Template not found');

    const isCustom = (template.code ?? '').toUpperCase() === CUSTOM_CODE;

    // Build the item list differently per mode.
    //
    //   STANDARD template → use the template's own items + requiredQty. If
    //                       the operator supplied custom quantities anyway,
    //                       ignore them (the whole point of a standard
    //                       template is that quantities are pre-agreed).
    //   CUSTOM template   → the operator supplies quantities inline; we map
    //                       them to the matching category by Category.code.
    //                       Zero-qty entries are dropped from the proposal
    //                       so the printable checklist stays short.
    const itemsForProposal: Array<{ categoryId: string; categoryName: string; requiredQty: number }> = [];

    if (isCustom) {
      const customInputs: CustomInputs = {
        posPoints: dto.posPoints ?? 0,
        offices:   dto.offices   ?? 0,
        printers:  dto.printers  ?? 0,
        screens:   dto.screens   ?? 0,
      };
      // Pull any category that's in our CUSTOM_CATEGORY_MAP. Load them all
      // in one query to keep this cheap even for big category catalogs.
      const codes = Object.keys(CUSTOM_CATEGORY_MAP);
      const cats = await this.prisma.category.findMany({ where: { code: { in: codes } } });
      for (const cat of cats) {
        const mapKey = CUSTOM_CATEGORY_MAP[cat.code];
        const qty = mapKey ? customInputs[mapKey] : 0;
        if (qty > 0) {
          itemsForProposal.push({ categoryId: cat.id, categoryName: cat.name, requiredQty: qty });
        }
      }
      if (itemsForProposal.length === 0) {
        throw new BadRequestException(
          'Custom template selected but no quantities supplied. Fill in at least one of POS/Office/Printer/Monitor.',
        );
      }
    } else {
      for (const i of template.items) {
        itemsForProposal.push({
          categoryId:   i.categoryId,
          categoryName: i.category.name,
          requiredQty:  i.requiredQty,
        });
      }
    }

    // Cost each line at the average unit cost across its category's SKUs.
    // Categories with no priced SKUs land at R0 — the operator can override
    // before committing. This matches the old wizard's behaviour.
    const equipment: Array<{
      categoryName: string; qty: number; unitCostCents: number; lineCostCents: number;
    }> = [];
    let equipmentTotal = 0;
    for (const it of itemsForProposal) {
      const skus = await this.prisma.sku.findMany({
        where: { categoryId: it.categoryId, unitCostCents: { gt: 0 } },
      });
      const avg = skus.length === 0
        ? 0
        : Math.round(skus.reduce((s, k) => s + k.unitCostCents, 0) / skus.length);
      const line = avg * it.requiredQty;
      equipmentTotal += line;
      equipment.push({
        categoryName:  it.categoryName,
        qty:           it.requiredQty,
        unitCostCents: avg,
        lineCostCents: line,
      });
    }

    const installation = dto.installationCostCents ?? 5000_00;
    const travel       = dto.travelCostCents       ?? 2500_00;
    const labour       = dto.labourCostCents       ?? 4000_00;
    const subtotal     = equipmentTotal + installation + travel + labour;
    const contingencyPct = dto.contingencyPct ?? 10;
    const contingency = Math.round(subtotal * (contingencyPct / 100));
    const total       = subtotal + contingency;

    return {
      input: {
        name:       dto.name,
        entity:     dto.entity,
        templateId: dto.templateId,
        templateName: template.name,
        templateCode: template.code,
        region:     dto.region,
        isCustom,
      },
      equipment,
      costs: {
        equipmentCents:    equipmentTotal,
        installationCents: installation,
        travelCents:       travel,
        labourCents:       labour,
        contingencyCents:  contingency,
        contingencyPct,
        totalCents:        total,
      },
    };
  }

  /**
   * Create the Location + Store rows. The brand determines the code prefix
   * when none is supplied:
   *   FASHION_FUSION  → FFN<nnnn>
   *   EVLV            → EVL<nnnn>
   *   BOTH            → MB<nnnn>    (My Brands shared-location)
   * The next free numeric is chosen by scanning existing Store.code with the
   * matching prefix. Collisions still get caught by the unique constraint,
   * so this is best-effort then fail-safe.
   */
  /**
   * Delegate to StoresService.create so the wizard goes through the same
   * path as the "Register existing store" form — which means we also get
   * Location upsert, BackupJob auto-creation, and STORE_MANAGER login
   * provisioning (if a contactEmail was supplied). No duplicated logic.
   */
  private async createStoreFromProposal(dto: WizardDto, _proposal: any) {
    const prefix =
      dto.entity === 'EVLV' ? 'EVL' :
      dto.entity === 'BOTH' ? 'MB'  :
                              'FFN';
    const code = (dto.storeCode?.trim() || await this.allocateStoreCode(prefix)).toUpperCase();

    return this.stores.create({
      code,
      name:          dto.name,
      region:        dto.region,
      entity:        dto.entity === 'BOTH' ? 'FASHION_FUSION' : dto.entity,
      templateId:    dto.templateId,
      status:        dto.status ?? 'PLANNED',
      openedAt:      dto.openedAt,
      areaManagerId: dto.areaManagerId,
      contactEmail:  dto.contactEmail,
    } as any);
  }

  private async allocateStoreCode(prefix: string): Promise<string> {
    // Find the highest numeric suffix on existing codes with this prefix,
    // bump it by one, zero-pad to 4 digits. Not strictly concurrent-safe,
    // but the unique constraint will reject duplicates — a UI retry is
    // enough recovery, and rapid-fire store creation is rare.
    const rows = await this.prisma.store.findMany({
      where: { code: { startsWith: prefix } },
      select: { code: true },
    });
    let maxN = 0;
    const re = new RegExp(`^${prefix}0*(\\d+)$`);
    for (const { code } of rows) {
      const m = re.exec(code);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    }
    return `${prefix}${String(maxN + 1).padStart(4, '0')}`;
  }

  // ---- PDF renderer --------------------------------------------------------

  private renderPdf(dto: WizardDto, proposal: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data',  (c: Buffer) => chunks.push(c));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const brand =
        dto.entity === 'EVLV' ? 'Evolve' :
        dto.entity === 'BOTH' ? 'My Brands' :
                                'Fashion Fusion';

      // Header
      doc.fontSize(20).fillColor('#1e293b').text(`${brand} — New Store Proposal`, { align: 'left' });
      doc.moveDown(0.3);
      doc.fontSize(12).fillColor('#64748b').text(`Store: ${dto.name}`);
      doc.text(`Region: ${dto.region}`);
      doc.text(`Template: ${proposal.input.templateName}${proposal.input.isCustom ? ' (custom quantities)' : ''}`);
      doc.text(`Generated: ${new Date().toLocaleString()}`);
      doc.moveDown(0.8);

      // Equipment checklist
      doc.fontSize(14).fillColor('#1e293b').text('Equipment checklist', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(11);

      const col = { name: 50, qty: 320, unit: 380, line: 480 };
      doc.fillColor('#334155').text('Item',            col.name, doc.y, { continued: true });
      doc.text('Qty',  col.qty - col.name,  undefined, { continued: true });
      doc.text('Unit', col.unit - col.qty,  undefined, { continued: true });
      doc.text('Line', col.line - col.unit, undefined);
      doc.moveDown(0.3);
      doc.strokeColor('#cbd5e1').moveTo(40, doc.y).lineTo(560, doc.y).stroke();
      doc.moveDown(0.2);

      for (const e of proposal.equipment as any[]) {
        const y = doc.y;
        doc.fillColor('#0f172a').text('☐ ' + e.categoryName, col.name, y);
        doc.text(String(e.qty),                   col.qty,  y);
        doc.text(formatRand(e.unitCostCents),     col.unit, y);
        doc.text(formatRand(e.lineCostCents),     col.line, y);
        doc.moveDown(0.3);
      }

      doc.moveDown(0.6);
      doc.strokeColor('#cbd5e1').moveTo(40, doc.y).lineTo(560, doc.y).stroke();
      doc.moveDown(0.4);

      // Costs table
      doc.fontSize(14).fillColor('#1e293b').text('Costs');
      doc.moveDown(0.4);
      doc.fontSize(11).fillColor('#334155');
      const rows: Array<[string, number]> = [
        ['Equipment subtotal',  proposal.costs.equipmentCents],
        ['Installation',        proposal.costs.installationCents],
        ['Travel',              proposal.costs.travelCents],
        ['Labour',              proposal.costs.labourCents],
        [`Contingency (${proposal.costs.contingencyPct}%)`, proposal.costs.contingencyCents],
      ];
      for (const [label, cents] of rows) {
        doc.text(label, 50, doc.y, { continued: true });
        doc.text(formatRand(cents), { align: 'right' });
      }
      doc.moveDown(0.4);
      doc.fontSize(13).fillColor('#1e293b').text('Total', 50, doc.y, { continued: true });
      doc.text(formatRand(proposal.costs.totalCents), { align: 'right' });

      doc.moveDown(2);
      doc.fontSize(9).fillColor('#94a3b8').text(
        'Proposal generated by ITAMLS Store Wizard. Costs use the current average unit price per category — overridable at commit time.',
      );

      doc.end();
    });
  }
}

function formatRand(cents: number): string {
  const r = (cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `R ${r}`;
}
