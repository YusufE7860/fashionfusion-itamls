import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AssetStatus, AssetStatusT } from '../shared';

export class CreateAssetDto {
  @IsString() assetTag!: string;
  @IsOptional() @IsString() serialNo?: string;
  @IsString() skuId!: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() purchaseDate?: string;
  @IsOptional() @IsInt() @Min(0) purchaseCostCents?: number;
  @IsOptional() @IsString() warrantyExpiry?: string;
  @IsOptional() @IsString() condition?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() assignedStoreId?: string;
  @IsOptional() @IsString() assignedDepartmentId?: string;
}

export class MoveAssetDto {
  @IsString() toLocationId!: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() newStatus?: AssetStatusT;
}

export interface ListAssetsQuery {
  status?: AssetStatusT;
  locationId?: string;
  categoryId?: string;
  assignedStoreId?: string;
  assignedDepartmentId?: string;
  hqOnly?: string;   // "true" -> only assets whose location.type = HEAD_OFFICE
  q?: string;
}

@Injectable()
export class AssetsService {
  constructor(private prisma: PrismaService) {}

  async list(q: ListAssetsQuery) {
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.locationId) where.locationId = q.locationId;
    if (q.categoryId) where.sku = { categoryId: q.categoryId };
    if (q.assignedStoreId) where.assignedStoreId = q.assignedStoreId;
    if (q.assignedDepartmentId) where.assignedDepartmentId = q.assignedDepartmentId;
    if (q.hqOnly === 'true') {
      where.location = { type: 'HEAD_OFFICE' };
    }
    if (q.q) {
      where.OR = [
        { assetTag: { contains: q.q, mode: 'insensitive' } },
        { serialNo: { contains: q.q, mode: 'insensitive' } },
        { sku: { name: { contains: q.q, mode: 'insensitive' } } },
        { sku: { model: { contains: q.q, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.asset.findMany({
      where,
      include: {
        sku: { include: { category: true } },
        supplier: true,
        location: true,
        assignedStore: true,
        assignedUser: true,
        assignedDepartment: true,
      },
      orderBy: { assetTag: 'asc' },
      take: 500,
    });
  }

  async byId(id: string) {
    const a = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        sku: { include: { category: true } },
        supplier: true,
        location: true,
        assignedStore: true,
        assignedUser: true,
        history: {
          orderBy: { occurredAt: 'desc' },
          take: 50,
          include: { fromLoc: true, toLoc: true, actor: true },
        },
        repairs: { orderBy: { createdAt: 'desc' }, take: 20, include: { supplier: true } },
      },
    });
    if (!a) throw new NotFoundException();
    // Inline helpdesk tickets (cheap; fewer joins than relation)
    const tickets = await this.prisma.helpdeskLink.findMany({
      where: { assetId: id },
      orderBy: { openedAt: 'desc' },
      take: 15,
    });
    return { ...a, tickets };
  }

  async create(dto: CreateAssetDto, actorId: string) {
    const exists = await this.prisma.asset.findUnique({ where: { assetTag: dto.assetTag } });
    if (exists) throw new BadRequestException('Asset tag already exists');
    const a = await this.prisma.asset.create({
      data: {
        assetTag: dto.assetTag,
        serialNo: dto.serialNo,
        skuId: dto.skuId,
        supplierId: dto.supplierId,
        purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
        purchaseCostCents: dto.purchaseCostCents ?? 0,
        currentValueCents: dto.purchaseCostCents ?? 0,
        warrantyExpiry: dto.warrantyExpiry ? new Date(dto.warrantyExpiry) : undefined,
        condition: dto.condition,
        locationId: dto.locationId,
        assignedStoreId: dto.assignedStoreId,
        assignedDepartmentId: dto.assignedDepartmentId,
        status: dto.assignedStoreId || dto.assignedDepartmentId ? AssetStatus.InStore : AssetStatus.InStock,
      },
    });
    await this.prisma.assetHistory.create({
      data: {
        assetId: a.id,
        eventType: 'PURCHASED',
        toLocationId: dto.locationId,
        actorId,
      },
    });
    return a;
  }

  async assignToDepartment(id: string, departmentId: string | null, actorId: string) {
    const a = await this.prisma.asset.findUnique({ where: { id } });
    if (!a) throw new NotFoundException();
    const updated = await this.prisma.asset.update({
      where: { id },
      data: {
        assignedDepartmentId: departmentId,
        // Assigning to a department implies leaving stock and being in service
        status: departmentId ? AssetStatus.InStore : a.status,
      },
    });
    await this.prisma.assetHistory.create({
      data: {
        assetId: id, eventType: departmentId ? 'ASSIGNED' : 'UNASSIGNED', actorId,
        notes: departmentId ? `Assigned to department ${departmentId}` : 'Unassigned from department',
      },
    });
    return updated;
  }

  async move(id: string, dto: MoveAssetDto, actorId: string) {
    const a = await this.prisma.asset.findUnique({ where: { id } });
    if (!a) throw new NotFoundException();
    const updated = await this.prisma.asset.update({
      where: { id },
      data: {
        locationId: dto.toLocationId,
        status: dto.newStatus ?? a.status,
      },
    });
    await this.prisma.assetHistory.create({
      data: {
        assetId: id,
        eventType: 'MOVED',
        fromLocationId: a.locationId ?? undefined,
        toLocationId: dto.toLocationId,
        actorId,
        notes: dto.notes,
      },
    });
    return updated;
  }
}
