import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AssetStatus } from '../shared';

export class CreateAuditDto {
  @IsString() storeId!: string;
  @IsOptional() @IsString() scheduledFor?: string;
}

@Injectable()
export class AuditsService {
  constructor(private prisma: PrismaService) {}

  list(storeId?: string) {
    return this.prisma.audit.findMany({
      where: storeId ? { storeId } : undefined,
      orderBy: { scheduledFor: 'desc' },
      include: { store: true, lines: true },
    });
  }

  async byId(id: string) {
    const a = await this.prisma.audit.findUnique({
      where: { id },
      include: {
        store: true,
        lines: true,
      },
    });
    if (!a) throw new NotFoundException();
    // Enrich each line with the asset record if linked
    const assetIds = a.lines.map((l) => l.assetId).filter((x): x is string => !!x);
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      include: { sku: { include: { category: true } } },
    });
    const map = new Map(assets.map((x) => [x.id, x]));
    return {
      ...a,
      lines: a.lines.map((l) => ({ ...l, asset: l.assetId ? map.get(l.assetId) : null })),
    };
  }

  private async nextCode() {
    const c = await this.prisma.audit.count();
    return `AUD-${new Date().getFullYear()}-${String(c + 1).padStart(5, '0')}`;
  }

  /**
   * Create an audit; auto-populate AuditLines from every asset currently
   * assigned to that store as "expected".
   */
  async create(dto: CreateAuditDto, conductedById: string) {
    return this.prisma.$transaction(async (tx) => {
      const expected = await tx.asset.findMany({
        where: { assignedStoreId: dto.storeId, status: AssetStatus.InStore },
      });

      const audit = await tx.audit.create({
        data: {
          code: await (async () => {
            const c = await tx.audit.count();
            return `AUD-${new Date().getFullYear()}-${String(c + 1).padStart(5, '0')}`;
          })(),
          storeId: dto.storeId,
          scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : new Date(),
          status: 'SCHEDULED',
          conductedById,
          lines: {
            create: expected.map((a) => ({
              assetId: a.id, expected: true, found: false,
            })),
          },
        },
        include: { lines: true },
      });
      return audit;
    });
  }

  /**
   * Process a scan: look up the asset by tag, find the matching audit line,
   * mark it found. If the tag isn't in the expected register, create a new
   * "unrecorded" line.
   */
  async scan(auditId: string, assetTag: string, condition?: string, notes?: string) {
    const audit = await this.prisma.audit.findUnique({ where: { id: auditId } });
    if (!audit) throw new NotFoundException();

    const asset = await this.prisma.asset.findUnique({ where: { assetTag } });
    if (!asset) {
      // Unknown tag — create unrecorded line
      return this.prisma.auditLine.create({
        data: {
          auditId, expected: false, found: true, condition, notes,
          variance: 'UNRECORDED',
        },
      });
    }
    const line = await this.prisma.auditLine.findFirst({
      where: { auditId, assetId: asset.id },
    });
    if (!line) {
      // Not on expected register, but asset exists — still log as unrecorded
      return this.prisma.auditLine.create({
        data: {
          auditId, assetId: asset.id, expected: false, found: true,
          condition, notes, variance: 'UNRECORDED',
        },
      });
    }
    return this.prisma.auditLine.update({
      where: { id: line.id },
      data: { found: true, condition, notes, variance: null },
    });
  }

  /** Flag a line as damaged/missing manually. */
  async markVariance(lineId: string, variance: string, notes?: string) {
    if (!['MISSING', 'DAMAGED', 'UNRECORDED'].includes(variance)) {
      throw new BadRequestException('Invalid variance');
    }
    return this.prisma.auditLine.update({
      where: { id: lineId },
      data: { variance, notes },
    });
  }

  /** Close the audit; remaining expected-not-found lines become MISSING. */
  async complete(auditId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.auditLine.updateMany({
        where: { auditId, expected: true, found: false, variance: null },
        data: { variance: 'MISSING' },
      });
      return tx.audit.update({
        where: { id: auditId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    });
  }

  async summary(auditId: string) {
    const lines = await this.prisma.auditLine.findMany({ where: { auditId } });
    return {
      total: lines.length,
      found: lines.filter((l) => l.found).length,
      missing: lines.filter((l) => l.variance === 'MISSING').length,
      damaged: lines.filter((l) => l.variance === 'DAMAGED').length,
      unrecorded: lines.filter((l) => l.variance === 'UNRECORDED').length,
    };
  }
}
