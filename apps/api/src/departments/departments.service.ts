import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DepartmentDto {
  code?: string;
  name: string;
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
}

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  list(includeInactive = false) {
    return this.prisma.department.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { assets: true } } },
    });
  }

  async create(dto: DepartmentDto) {
    if (!dto.name?.trim()) throw new BadRequestException('name required');
    const code = (dto.code?.trim() || dto.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)) || 'DEPT';
    const existing = await this.prisma.department.findUnique({ where: { code } });
    if (existing) throw new BadRequestException(`Department code ${code} already exists`);
    return this.prisma.department.create({
      data: {
        code, name: dto.name.trim(), description: dto.description,
        sortOrder: dto.sortOrder ?? 100, isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: DepartmentDto) {
    const d = await this.prisma.department.findUnique({ where: { id } });
    if (!d) throw new NotFoundException();
    return this.prisma.department.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? d.name,
        description: dto.description ?? d.description,
        sortOrder: dto.sortOrder ?? d.sortOrder,
        isActive: dto.isActive ?? d.isActive,
      },
    });
  }

  async remove(id: string) {
    const count = await this.prisma.asset.count({ where: { assignedDepartmentId: id } });
    if (count > 0) {
      // Soft delete — keep history intact
      return this.prisma.department.update({ where: { id }, data: { isActive: false } });
    }
    return this.prisma.department.delete({ where: { id } });
  }
}
