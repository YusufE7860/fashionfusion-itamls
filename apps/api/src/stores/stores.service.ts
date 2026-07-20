import { Injectable, NotFoundException } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { LocationType, StoreStatus } from '../shared';

export class CreateStoreDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() region!: string;
  @IsOptional() @IsString() entity?: string;      // FASHION_FUSION | EVLV
  @IsOptional() @IsString() status?: string;      // OPEN | PLANNED | REMODEL | CLOSED
  @IsOptional() @IsString() templateId?: string;
  @IsOptional() @IsString() openedAt?: string;    // ISO date
}

@Injectable()
export class StoresService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.store.findMany({
      orderBy: { code: 'asc' },
      include: { template: true, location: true },
    });
  }

  async byId(id: string) {
    const s = await this.prisma.store.findUnique({
      where: { id },
      include: {
        template: { include: { items: { include: { category: true } } } },
        location: true,
        assignedAssets: { include: { sku: { include: { category: true } } } },
      },
    });
    if (!s) throw new NotFoundException();
    return s;
  }

  async create(dto: CreateStoreDto) {
    // Create the location and store together
    const location = await this.prisma.location.create({
      data: {
        code: dto.code,
        name: dto.name,
        type: LocationType.Store,
        region: dto.region,
      },
    });
    const store = await this.prisma.store.create({
      data: {
        code: dto.code,
        name: dto.name,
        region: dto.region,
        entity: dto.entity ?? 'FASHION_FUSION',
        locationId: location.id,
        templateId: dto.templateId || undefined,
        status: dto.status ?? StoreStatus.Open,
        openedAt: dto.openedAt ? new Date(dto.openedAt) : new Date(),
      },
      include: { template: true, location: true },
    });
    // Auto-create a Backups job for the new store (default: 02:00 daily, 30-day retention)
    await this.prisma.backupJob.upsert({
      where: { storeId: store.id },
      create: { storeId: store.id },
      update: {},
    });
    return store;
  }
}
