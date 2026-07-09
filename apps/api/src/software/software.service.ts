import { Injectable, NotFoundException } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

export class CreateTitleDto {
  @IsString() name!: string;
  @IsString() vendor!: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() notes?: string;
}
export class CreateLicenseDto {
  @IsString() titleId!: string;
  @IsOptional() @IsString() licenseKey?: string;
  @IsOptional() @IsInt() @Min(1) seatsTotal?: number;
  @IsOptional() @IsInt() @Min(0) costCents?: number;
  @IsOptional() @IsString() purchaseDate?: string;
  @IsOptional() @IsString() expiryDate?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() notes?: string;
}
export class AssignDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @IsString() notes?: string;
}

@Injectable()
export class SoftwareService {
  constructor(private prisma: PrismaService) {}

  // ---- Titles ----
  titles() {
    return this.prisma.softwareTitle.findMany({
      orderBy: { name: 'asc' },
      include: { licenses: { include: { assignments: { where: { revokedAt: null } } } } },
    });
  }
  createTitle(dto: CreateTitleDto) { return this.prisma.softwareTitle.create({ data: dto }); }

  // ---- Licenses ----
  async createLicense(dto: CreateLicenseDto) {
    const mask = dto.licenseKey ? `••••••${dto.licenseKey.slice(-4)}` : null;
    return this.prisma.softwareLicense.create({
      data: {
        ...dto,
        licenseKeyMask: mask,
        purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
      },
    });
  }
  async license(id: string) {
    const l = await this.prisma.softwareLicense.findUnique({
      where: { id },
      include: {
        title: true, supplier: true,
        assignments: { where: { revokedAt: null } },
      },
    });
    if (!l) throw new NotFoundException();
    return l;
  }

  // ---- Assignments ----
  async assign(licenseId: string, dto: AssignDto) {
    const license = await this.prisma.softwareLicense.findUnique({
      where: { id: licenseId },
      include: { assignments: { where: { revokedAt: null } } },
    });
    if (!license) throw new NotFoundException();
    if (license.assignments.length >= license.seatsTotal) {
      throw new Error('All seats are assigned. Revoke an existing seat first.');
    }
    return this.prisma.softwareAssignment.create({
      data: { licenseId, userId: dto.userId, assetId: dto.assetId, notes: dto.notes },
    });
  }
  revoke(assignmentId: string) {
    return this.prisma.softwareAssignment.update({
      where: { id: assignmentId }, data: { revokedAt: new Date() },
    });
  }

  // ---- Dashboard summary ----
  async summary() {
    const now = new Date();
    const horizon = new Date(); horizon.setDate(horizon.getDate() + 60);
    const [titles, licenses, expiringSoon, expired] = await Promise.all([
      this.prisma.softwareTitle.count(),
      this.prisma.softwareLicense.count(),
      this.prisma.softwareLicense.count({ where: { expiryDate: { gte: now, lte: horizon } } }),
      this.prisma.softwareLicense.count({ where: { expiryDate: { lt: now } } }),
    ]);
    const allLicenses = await this.prisma.softwareLicense.findMany({
      include: { assignments: { where: { revokedAt: null } } },
    });
    const seatsTotal = allLicenses.reduce((s, l) => s + l.seatsTotal, 0);
    const seatsUsed  = allLicenses.reduce((s, l) => s + l.assignments.length, 0);
    const annualSpend = allLicenses.reduce((s, l) => s + l.costCents, 0);
    return { titles, licenses, expiringSoon, expired, seatsTotal, seatsUsed, annualSpendCents: annualSpend };
  }
}
