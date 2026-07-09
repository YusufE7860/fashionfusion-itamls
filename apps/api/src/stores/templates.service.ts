import { Injectable, NotFoundException } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';

export class TemplateItemDto {
  @IsString() categoryId!: string;
  @IsInt() @Min(0) requiredQty!: number;
}
export class CreateTemplateDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => TemplateItemDto) items!: TemplateItemDto[];
}
export class UpdateTemplateDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
}
export class UpsertItemDto {
  @IsString() categoryId!: string;
  @IsInt() @Min(0) requiredQty!: number;
}

@Injectable()
export class TemplatesService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.storeTemplate.findMany({
      orderBy: { name: 'asc' },
      include: { items: { include: { category: true } } },
    });
  }

  async byId(id: string) {
    const t = await this.prisma.storeTemplate.findUnique({
      where: { id },
      include: { items: { include: { category: true } } },
    });
    if (!t) throw new NotFoundException();
    return t;
  }

  create(dto: CreateTemplateDto) {
    return this.prisma.storeTemplate.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        items: { create: dto.items },
      },
      include: { items: { include: { category: true } } },
    });
  }

  update(id: string, dto: UpdateTemplateDto) {
    return this.prisma.storeTemplate.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    const inUse = await this.prisma.store.count({ where: { templateId: id } });
    if (inUse > 0) {
      throw new NotFoundException(`Template is used by ${inUse} store(s); reassign first.`);
    }
    await this.prisma.storeTemplateItem.deleteMany({ where: { templateId: id } });
    return this.prisma.storeTemplate.delete({ where: { id } });
  }

  upsertItem(templateId: string, dto: UpsertItemDto) {
    return this.prisma.storeTemplateItem.upsert({
      where: { templateId_categoryId: { templateId, categoryId: dto.categoryId } },
      update: { requiredQty: dto.requiredQty },
      create: { templateId, categoryId: dto.categoryId, requiredQty: dto.requiredQty },
      include: { category: true },
    });
  }

  removeItem(itemId: string) {
    return this.prisma.storeTemplateItem.delete({ where: { id: itemId } });
  }
}
