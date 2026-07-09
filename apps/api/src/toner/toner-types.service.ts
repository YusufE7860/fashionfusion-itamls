import { Injectable } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

export class CreateTonerTypeDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsInt() @Min(0) unitCostCents?: number;
  @IsOptional() @IsInt() @Min(0) vatPct?: number;
  @IsOptional() @IsInt() @Min(0) hqStock?: number;
  @IsOptional() @IsInt() @Min(0) reorderLevel?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateTonerTypeDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsInt() @Min(0) unitCostCents?: number;
  @IsOptional() @IsInt() @Min(0) vatPct?: number;
  @IsOptional() @IsInt() @Min(0) hqStock?: number;
  @IsOptional() @IsInt() @Min(0) reorderLevel?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Injectable()
export class TonerTypesService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.tonerType.findMany({ orderBy: { code: 'asc' } });
  }

  create(dto: CreateTonerTypeDto) {
    return this.prisma.tonerType.create({ data: dto });
  }

  update(id: string, dto: UpdateTonerTypeDto) {
    return this.prisma.tonerType.update({ where: { id }, data: dto });
  }

  /** Adjust HQ stock by a delta (positive = receive, negative = consume). */
  async adjustStock(id: string, delta: number) {
    return this.prisma.tonerType.update({
      where: { id },
      data: { hqStock: { increment: delta } },
    });
  }
}
