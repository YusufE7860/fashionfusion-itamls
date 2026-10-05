import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface RegionDto { code: string; name: string; isActive?: boolean }
export interface AreaManagerDto {
  fullName: string;
  email: string;
  phone?: string;
  regionId?: string | null;
  assignedTechId?: string | null;
  isActive?: boolean;
  notes?: string;
  storeIds?: string[];                 // stores to attach (full replace)
}

@Injectable()
export class RegionsService {
  constructor(private prisma: PrismaService) {}
  list() {
    return this.prisma.region.findMany({
      orderBy: { code: 'asc' },
      include: {
        _count: { select: { stores: true, areaManagers: true } },
      },
    });
  }
  async create(dto: RegionDto) {
    if (!dto.code?.trim() || !dto.name?.trim()) throw new BadRequestException('code and name required');
    return this.prisma.region.create({
      data: { code: dto.code.trim().toUpperCase(), name: dto.name.trim(), isActive: dto.isActive ?? true },
    });
  }
  async update(id: string, dto: RegionDto) {
    const r = await this.prisma.region.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    return this.prisma.region.update({
      where: { id },
      data: {
        code: dto.code?.trim().toUpperCase() ?? r.code,
        name: dto.name?.trim() ?? r.name,
        isActive: dto.isActive ?? r.isActive,
      },
    });
  }
  async remove(id: string) {
    const inUse = await this.prisma.store.count({ where: { regionId: id } });
    if (inUse > 0) throw new BadRequestException(`Region has ${inUse} store(s). Remove them first or deactivate instead.`);
    await this.prisma.region.delete({ where: { id } });
    return { ok: true };
  }
}

@Injectable()
export class AreaManagersService {
  constructor(private prisma: PrismaService) {}

  list(includeInactive = false) {
    return this.prisma.areaManager.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
      include: {
        region:       { select: { id: true, code: true, name: true } },
        assignedTech: { select: { id: true, fullName: true, email: true } },
        _count: { select: { stores: true, tickets: true } },
      },
    });
  }

  async get(id: string) {
    const am = await this.prisma.areaManager.findUnique({
      where: { id },
      include: {
        region: true,
        assignedTech: { select: { id: true, fullName: true, email: true } },
        stores: { select: { id: true, code: true, name: true, region: true } },
      },
    });
    if (!am) throw new NotFoundException();
    return am;
  }

  async create(dto: AreaManagerDto) {
    if (!dto.fullName?.trim() || !dto.email?.trim()) throw new BadRequestException('fullName and email required');
    const am = await this.prisma.areaManager.create({
      data: {
        fullName: dto.fullName.trim(),
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone ?? null,
        regionId: dto.regionId || null,
        assignedTechId: dto.assignedTechId || null,
        isActive: dto.isActive ?? true,
        notes: dto.notes ?? null,
      },
    });
    if (dto.storeIds?.length) await this.setStores(am.id, dto.storeIds);
    return this.get(am.id);
  }

  async update(id: string, dto: AreaManagerDto) {
    const am = await this.prisma.areaManager.findUnique({ where: { id } });
    if (!am) throw new NotFoundException();
    await this.prisma.areaManager.update({
      where: { id },
      data: {
        fullName:       dto.fullName?.trim() ?? am.fullName,
        email:          dto.email?.trim().toLowerCase() ?? am.email,
        phone:          dto.phone === undefined ? am.phone : (dto.phone || null),
        regionId:       dto.regionId === undefined ? am.regionId : (dto.regionId || null),
        assignedTechId: dto.assignedTechId === undefined ? am.assignedTechId : (dto.assignedTechId || null),
        isActive:       dto.isActive ?? am.isActive,
        notes:          dto.notes === undefined ? am.notes : dto.notes,
      },
    });
    if (dto.storeIds !== undefined) await this.setStores(id, dto.storeIds ?? []);
    return this.get(id);
  }

  async remove(id: string) {
    const ticketCount = await this.prisma.ticket.count({ where: { areaManagerId: id } });
    if (ticketCount > 0) {
      // Deactivate instead so tickets keep their reference
      await this.prisma.areaManager.update({ where: { id }, data: { isActive: false } });
      return { ok: true, deactivated: true, ticketCount };
    }
    // Detach stores first
    await this.prisma.store.updateMany({ where: { areaManagerId: id }, data: { areaManagerId: null } });
    await this.prisma.areaManager.delete({ where: { id } });
    return { ok: true };
  }

  /** Replace this AM's store assignments. */
  async setStores(id: string, storeIds: string[]) {
    await this.prisma.$transaction([
      this.prisma.store.updateMany({ where: { areaManagerId: id }, data: { areaManagerId: null } }),
      ...(storeIds.length
        ? [this.prisma.store.updateMany({ where: { id: { in: storeIds } }, data: { areaManagerId: id } })]
        : []),
    ]);
    return { ok: true, count: storeIds.length };
  }
}
