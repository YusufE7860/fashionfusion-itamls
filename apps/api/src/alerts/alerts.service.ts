import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { Permissions } from '../shared';

type AlertType =
  | 'WARRANTY_30' | 'WARRANTY_60' | 'WARRANTY_90'
  | 'LOW_STOCK'
  | 'STORE_MISSING_EQUIPMENT'
  | 'REPAIR_DELAY'
  | 'ASSET_NOT_SEEN'
  | 'LICENSE_EXPIRING';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  constructor(private prisma: PrismaService, private mailer: MailerService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async nightlyCron() {
    this.logger.log('Nightly alert scan starting…');
    const result = await this.runAll();
    this.logger.log(`Alert scan complete: ${result.created} new alerts`);
    if (result.created > 0) await this.emailDigest();
  }

  async list(opts: { onlyActive?: boolean } = {}) {
    return this.prisma.alert.findMany({
      where: opts.onlyActive ? { dismissedAt: null } : undefined,
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
  }

  async summary() {
    const active = await this.prisma.alert.findMany({ where: { dismissedAt: null } });
    const bySeverity: Record<string, number> = { ERROR: 0, WARN: 0, INFO: 0 };
    const byType: Record<string, number> = {};
    for (const a of active) {
      bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
      byType[a.type] = (byType[a.type] ?? 0) + 1;
    }
    return { active: active.length, bySeverity, byType };
  }

  async dismiss(id: string) {
    return this.prisma.alert.update({ where: { id }, data: { dismissedAt: new Date() } });
  }

  async runAll() {
    const before = await this.prisma.alert.count();
    await this.warrantyScan();
    await this.lowStockScan();
    await this.complianceScan();
    await this.repairDelayScan();
    await this.assetNotSeenScan();
    await this.licenseExpiringScan();
    const after = await this.prisma.alert.count();
    return { created: after - before };
  }

  // ---------- email digest ----------
  private async emailDigest() {
    const recipients = await this.recipientsForDigest();
    if (recipients.length === 0) return;
    const active = await this.prisma.alert.findMany({ where: { dismissedAt: null }, orderBy: { severity: 'desc' }, take: 200 });
    const errors = active.filter((a) => a.severity === 'ERROR');
    const warns  = active.filter((a) => a.severity === 'WARN');
    if (errors.length === 0 && warns.length === 0) return;
    const html = this.mailer.wrap(
      `Daily alerts — ${errors.length} error(s), ${warns.length} warning(s)`,
      `<p>Hi,</p>
       <p>Today's automated scan found <b>${errors.length}</b> alerts at error level and <b>${warns.length}</b> at warn level.</p>
       ${this.renderList('Errors',  errors, '#ef4444')}
       ${this.renderList('Warnings', warns,  '#f59e0b')}
       <p style="margin-top:18px"><a href="${process.env.WEB_BASE_URL ?? 'http://localhost:5173'}/alerts"
          style="background:#fe6620;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;">Open Alerts dashboard →</a></p>`,
    );
    await this.mailer.send(recipients, `ITAMLS · ${errors.length + warns.length} active alerts`, html);
  }

  private renderList(label: string, items: any[], color: string) {
    if (items.length === 0) return '';
    const rows = items.slice(0, 25).map((a) => `
      <tr><td style="padding:6px 10px;border-bottom:1px solid #293659;font-size:13px;">
        <span style="color:${color};font-weight:700;">●</span> ${escapeHtml(a.message)}
      </td></tr>`).join('');
    const more = items.length > 25 ? `<tr><td style="padding:6px 10px;color:#7a8aa8;font-size:12px;">…and ${items.length - 25} more</td></tr>` : '';
    return `<div style="margin-top:14px"><div style="font-weight:700;color:#fff;margin-bottom:6px;">${label}</div>
      <table cellpadding="0" cellspacing="0" style="width:100%;background:#0f1626;border-radius:8px;">${rows}${more}</table></div>`;
  }

  private async recipientsForDigest() {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, role: { code: { in: ['ADMINISTRATOR', 'IT_MANAGER'] } } },
      select: { email: true },
    });
    return users.map((u) => u.email).filter(Boolean);
  }

  // ---------- scans ----------
  private async upsertOnce(type: AlertType, severity: string, refTable: string, refId: string, message: string) {
    const existing = await this.prisma.alert.findFirst({
      where: { type, refTable, refId, dismissedAt: null },
    });
    if (existing) return existing;
    return this.prisma.alert.create({
      data: { type, severity, refTable, refId, message },
    });
  }

  private async warrantyScan() {
    const now = new Date();
    const bands: { code: AlertType; days: number; severity: string }[] = [
      { code: 'WARRANTY_30', days: 30, severity: 'ERROR' },
      { code: 'WARRANTY_60', days: 60, severity: 'WARN' },
      { code: 'WARRANTY_90', days: 90, severity: 'INFO' },
    ];
    for (const b of bands) {
      const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() + b.days);
      const assets = await this.prisma.asset.findMany({
        where: { warrantyExpiry: { lte: cutoff, gte: now }, status: { notIn: ['DISPOSED', 'WRITTEN_OFF', 'LOST'] } },
        include: { sku: true }, take: 1000,
      });
      for (const a of assets) {
        await this.upsertOnce(b.code, b.severity, 'asset', a.id,
          `Warranty for ${a.assetTag} (${a.sku.model}) expires ${a.warrantyExpiry?.toISOString().slice(0,10)}`);
      }
    }
  }

  private async lowStockScan() {
    const rows = await this.prisma.stock.findMany({ include: { sku: true, location: true } });
    for (const r of rows) {
      if (r.reorderLevel > 0 && r.qtyOnHand <= r.reorderLevel) {
        await this.upsertOnce('LOW_STOCK', 'WARN', 'stock', r.id,
          `Low stock: ${r.sku.code} at ${r.location.name} (${r.qtyOnHand}/${r.reorderLevel})`);
      }
    }
  }

  private async complianceScan() {
    const stores = await this.prisma.store.findMany({ include: { template: { include: { items: true } } } });
    for (const s of stores) {
      if (!s.template) continue;
      const assets = await this.prisma.asset.findMany({
        where: { assignedStoreId: s.id, status: 'IN_STORE' }, include: { sku: true },
      });
      const byCategory = new Map<string, number>();
      for (const a of assets) byCategory.set(a.sku.categoryId, (byCategory.get(a.sku.categoryId) ?? 0) + 1);
      for (const item of s.template.items) {
        const installed = byCategory.get(item.categoryId) ?? 0;
        if (installed < item.requiredQty) {
          await this.upsertOnce('STORE_MISSING_EQUIPMENT', 'ERROR', 'store', s.id,
            `${s.code} ${s.name}: missing ${item.requiredQty - installed} item(s) in category ${item.categoryId}`);
        }
      }
    }
  }

  private async repairDelayScan() {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14);
    const stuck = await this.prisma.repair.findMany({
      where: { status: { in: ['SENT', 'AT_SUPPLIER'] }, sentAt: { lte: cutoff } },
      include: { asset: true },
    });
    for (const r of stuck) {
      await this.upsertOnce('REPAIR_DELAY', 'WARN', 'repair', r.id,
        `Repair ${r.code} on ${r.asset.assetTag} stuck in ${r.status} since ${r.sentAt?.toISOString().slice(0,10)}`);
    }
  }

  private async assetNotSeenScan() {
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 12);
    const cold = await this.prisma.asset.findMany({
      where: { source: 'DISCOVERY', lastSeenAt: { lt: cutoff }, status: { notIn: ['DISPOSED', 'WRITTEN_OFF', 'LOST'] } }, take: 500,
    });
    for (const a of cold) {
      await this.upsertOnce('ASSET_NOT_SEEN', 'INFO', 'asset', a.id,
        `Discovered asset ${a.assetTag} not seen by Kaseya agent since ${a.lastSeenAt?.toISOString().slice(0,10)}`);
    }
  }

  private async licenseExpiringScan() {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + 60);
    const licenses = await (this.prisma as any).softwareLicense?.findMany?.({
      where: { expiryDate: { lte: cutoff, gte: new Date() } },
      include: { title: true },
    }).catch(() => []) ?? [];
    for (const l of licenses) {
      await this.upsertOnce('LICENSE_EXPIRING', 'WARN', 'license', l.id,
        `License "${l.title?.name}" (${l.licenseKeyMask ?? '—'}) expires ${l.expiryDate?.toISOString?.().slice(0,10)}`);
    }
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
}
