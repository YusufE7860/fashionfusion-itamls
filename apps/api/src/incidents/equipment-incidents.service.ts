import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Min,
} from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export const INCIDENT_TYPES   = ['BROKEN', 'LOST', 'STOLEN', 'DAMAGED', 'OTHER'] as const;
export const INCIDENT_STATUS  = [
  'OPEN', 'AOD_ISSUED', 'DEDUCTING', 'PAID', 'WRITTEN_OFF', 'RECOVERED', 'DISPUTED',
] as const;

export class CreateIncidentDto {
  @IsOptional() @IsString() storeId?: string;
  @IsOptional() @IsString() assetId?: string;
  @IsString() itemDescription!: string;
  @IsIn(INCIDENT_TYPES as any) incidentType!: typeof INCIDENT_TYPES[number];
  @IsString() incidentDate!: string;             // ISO date
  @IsString() responsibleName!: string;
  @IsOptional() @IsString() responsibleEmpNo?: string;
  @IsOptional() @IsString() description?: string;
  @IsInt() @Min(0) replacementCostCents!: number;
  @IsOptional() @IsBoolean() aodIssued?: boolean;
  @IsOptional() @IsString() aodNumber?: string;
  @IsOptional() @IsString() aodDate?: string;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateIncidentDto {
  @IsOptional() @IsString() storeId?: string;
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @IsString() itemDescription?: string;
  @IsOptional() @IsIn(INCIDENT_TYPES as any) incidentType?: typeof INCIDENT_TYPES[number];
  @IsOptional() @IsString() incidentDate?: string;
  @IsOptional() @IsString() responsibleName?: string;
  @IsOptional() @IsString() responsibleEmpNo?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) replacementCostCents?: number;
  @IsOptional() @IsBoolean() aodIssued?: boolean;
  @IsOptional() @IsString() aodNumber?: string;
  @IsOptional() @IsString() aodDate?: string;
  @IsOptional() @IsIn(INCIDENT_STATUS as any) status?: typeof INCIDENT_STATUS[number];
  @IsOptional() @IsString() notes?: string;
}

@Injectable()
export class EquipmentIncidentsService {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  private async nextCode(): Promise<string> {
    // INC-<YYYY>-NNNNN sequence. Counts across all years; year segment is
    // the current year at creation time for a nice readable code.
    const n = await this.prisma.equipmentIncident.count();
    return `INC-${new Date().getFullYear()}-${String(n + 1).padStart(5, '0')}`;
  }

  async list(filters: { status?: string; storeId?: string; search?: string } = {}) {
    const where: any = {};
    if (filters.status  && filters.status  !== 'ALL') where.status  = filters.status;
    if (filters.storeId && filters.storeId !== 'ALL') where.storeId = filters.storeId;
    if (filters.search) {
      const q = filters.search.trim();
      where.OR = [
        { code:             { contains: q, mode: 'insensitive' } },
        { itemDescription:  { contains: q, mode: 'insensitive' } },
        { responsibleName:  { contains: q, mode: 'insensitive' } },
        { responsibleEmpNo: { contains: q, mode: 'insensitive' } },
        { aodNumber:        { contains: q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.equipmentIncident.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        store:      { select: { id: true, code: true, name: true } },
        asset:      { select: { id: true, assetTag: true, serialNo: true } },
        reportedBy: { select: { id: true, fullName: true } },
      },
      take: 500,
    });
  }

  async byId(id: string) {
    const row = await this.prisma.equipmentIncident.findUnique({
      where: { id },
      include: {
        store:      { select: { id: true, code: true, name: true } },
        asset:      { select: { id: true, assetTag: true, serialNo: true } },
        reportedBy: { select: { id: true, fullName: true } },
      },
    });
    if (!row) throw new NotFoundException();
    // Resolve a short-lived download URL for the AOD file if present.
    if (row.aodFileKey) {
      try {
        (row as any).aodFileUrl = await this.storage.presignedGet(row.aodFileKey, 60 * 60);
      } catch { /* ignore — UI will treat it as missing */ }
    }
    return row;
  }

  async create(dto: CreateIncidentDto, reportedById: string) {
    if (!dto.itemDescription?.trim()) throw new BadRequestException('itemDescription required');
    if (!dto.responsibleName?.trim()) throw new BadRequestException('responsibleName required');
    return this.prisma.equipmentIncident.create({
      data: {
        code:                  await this.nextCode(),
        storeId:               dto.storeId ?? null,
        assetId:               dto.assetId ?? null,
        itemDescription:       dto.itemDescription.trim(),
        incidentType:          dto.incidentType,
        incidentDate:          new Date(dto.incidentDate),
        responsibleName:       dto.responsibleName.trim(),
        responsibleEmpNo:      dto.responsibleEmpNo?.trim() || null,
        description:           dto.description ?? null,
        replacementCostCents:  dto.replacementCostCents,
        aodIssued:             !!dto.aodIssued,
        aodNumber:             dto.aodNumber?.trim() || null,
        aodDate:               dto.aodDate ? new Date(dto.aodDate) : null,
        notes:                 dto.notes ?? null,
        status:                dto.aodIssued ? 'AOD_ISSUED' : 'OPEN',
        reportedById,
      },
    });
  }

  async update(id: string, dto: UpdateIncidentDto) {
    const row = await this.prisma.equipmentIncident.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    const data: any = { ...dto };
    if (dto.incidentDate) data.incidentDate = new Date(dto.incidentDate);
    if (dto.aodDate)      data.aodDate      = new Date(dto.aodDate);
    // Flipping aodIssued to true auto-moves OPEN → AOD_ISSUED unless the
    // operator explicitly picked another status in the same update.
    if (dto.aodIssued === true && row.status === 'OPEN' && !dto.status) {
      data.status = 'AOD_ISSUED';
    }
    return this.prisma.equipmentIncident.update({ where: { id }, data });
  }

  async remove(id: string) {
    const row = await this.prisma.equipmentIncident.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    // Delete the AOD file too if we have one — nothing else references it.
    if (row.aodFileKey) {
      try { await this.storage.remove(row.aodFileKey); } catch { /* ignore */ }
    }
    return this.prisma.equipmentIncident.delete({ where: { id } });
  }

  /** Upload a scanned AOD. The HTTP route accepts multipart; this is called
   *  with the pre-saved MinIO key by the controller. */
  async attachAod(id: string, storageKey: string) {
    const row = await this.prisma.equipmentIncident.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    // Replace any existing file (prevents orphaned blobs).
    if (row.aodFileKey && row.aodFileKey !== storageKey) {
      try { await this.storage.remove(row.aodFileKey); } catch { /* ignore */ }
    }
    return this.prisma.equipmentIncident.update({
      where: { id },
      data: {
        aodFileKey: storageKey,
        aodIssued: true,
        status: row.status === 'OPEN' ? 'AOD_ISSUED' : row.status,
      },
    });
  }

  /** Aggregate numbers for the top-of-page cards. */
  async summary() {
    const [open, aod, written, recovered, totalOutstanding] = await Promise.all([
      this.prisma.equipmentIncident.count({ where: { status: 'OPEN' } }),
      this.prisma.equipmentIncident.count({ where: { status: 'AOD_ISSUED' } }),
      this.prisma.equipmentIncident.count({ where: { status: 'WRITTEN_OFF' } }),
      this.prisma.equipmentIncident.count({ where: { status: { in: ['PAID', 'RECOVERED'] } } }),
      this.prisma.equipmentIncident.aggregate({
        where: { status: { notIn: ['PAID', 'RECOVERED', 'WRITTEN_OFF'] } },
        _sum: { replacementCostCents: true },
      }),
    ]);
    return {
      openCount:       open,
      aodIssuedCount:  aod,
      writtenOffCount: written,
      recoveredCount:  recovered,
      outstandingCents: totalOutstanding._sum.replacementCostCents ?? 0,
    };
  }
}
