import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CategoryDto {
  code?: string;
  name: string;
  description?: string;
  defaultPriority?: 'P1' | 'P2' | 'P3' | 'P4';
  defaultAssigneeId?: string | null;
  slaPolicyId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface SlaPolicyDto {
  code?: string;
  name: string;
  description?: string;
  p1FirstResponseMinutes?: number; p1ResolveMinutes?: number;
  p2FirstResponseMinutes?: number; p2ResolveMinutes?: number;
  p3FirstResponseMinutes?: number; p3ResolveMinutes?: number;
  p4FirstResponseMinutes?: number; p4ResolveMinutes?: number;
  businessHoursOnly?: boolean;
  isDefault?: boolean;
}

@Injectable()
export class HelpdeskAdminService {
  constructor(private prisma: PrismaService) {}

  // ---- Categories ----
  listCategories(includeInactive = false) {
    return this.prisma.ticketCategory.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { defaultAssignee: { select: { id: true, fullName: true } }, slaPolicy: { select: { id: true, name: true } } },
    });
  }

  async createCategory(dto: CategoryDto) {
    if (!dto.name?.trim()) throw new BadRequestException('name required');
    const code = (dto.code?.trim() || dto.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)) || 'CAT';
    return this.prisma.ticketCategory.create({
      data: {
        code, name: dto.name.trim(), description: dto.description,
        defaultPriority: dto.defaultPriority ?? 'P3',
        defaultAssigneeId: dto.defaultAssigneeId ?? null,
        slaPolicyId: dto.slaPolicyId ?? null,
        sortOrder: dto.sortOrder ?? 100, isActive: dto.isActive ?? true,
      },
    });
  }

  async updateCategory(id: string, dto: CategoryDto) {
    const existing = await this.prisma.ticketCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    return this.prisma.ticketCategory.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? existing.name,
        description: dto.description ?? existing.description,
        defaultPriority: dto.defaultPriority ?? existing.defaultPriority,
        defaultAssigneeId: dto.defaultAssigneeId === undefined ? existing.defaultAssigneeId : dto.defaultAssigneeId,
        slaPolicyId:       dto.slaPolicyId       === undefined ? existing.slaPolicyId       : dto.slaPolicyId,
        sortOrder: dto.sortOrder ?? existing.sortOrder,
        isActive:  dto.isActive  ?? existing.isActive,
      },
    });
  }

  async deleteCategory(id: string) {
    const count = await this.prisma.ticket.count({ where: { categoryId: id } });
    if (count > 0) {
      return this.prisma.ticketCategory.update({ where: { id }, data: { isActive: false } });
    }
    return this.prisma.ticketCategory.delete({ where: { id } });
  }

  // ---- SLA policies ----
  listSlaPolicies() {
    return this.prisma.slaPolicy.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  }

  async createSlaPolicy(dto: SlaPolicyDto) {
    if (!dto.name?.trim()) throw new BadRequestException('name required');
    const code = (dto.code?.trim() || dto.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 20)) || 'SLA';
    return this.prisma.slaPolicy.create({
      data: {
        code, name: dto.name.trim(), description: dto.description,
        p1FirstResponseMinutes: dto.p1FirstResponseMinutes ?? 60,
        p1ResolveMinutes:       dto.p1ResolveMinutes       ?? 240,
        p2FirstResponseMinutes: dto.p2FirstResponseMinutes ?? 240,
        p2ResolveMinutes:       dto.p2ResolveMinutes       ?? 1440,
        p3FirstResponseMinutes: dto.p3FirstResponseMinutes ?? 480,
        p3ResolveMinutes:       dto.p3ResolveMinutes       ?? 2880,
        p4FirstResponseMinutes: dto.p4FirstResponseMinutes ?? 1440,
        p4ResolveMinutes:       dto.p4ResolveMinutes       ?? 7200,
        businessHoursOnly: dto.businessHoursOnly ?? false,
        isDefault:         dto.isDefault ?? false,
      },
    });
  }

  async updateSlaPolicy(id: string, dto: SlaPolicyDto) {
    const p = await this.prisma.slaPolicy.findUnique({ where: { id } });
    if (!p) throw new NotFoundException();
    // If flipping isDefault on, flip others off
    if (dto.isDefault === true) {
      await this.prisma.slaPolicy.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    }
    return this.prisma.slaPolicy.update({ where: { id }, data: { ...dto, code: undefined } });
  }
}
