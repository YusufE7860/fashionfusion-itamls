import { Injectable } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

export class CreateCategoryDto {
  @IsString() name!: string;
  @IsOptional() @IsString() parentId?: string;
}

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}
  list() {
    return this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { parent: true, children: true },
    });
  }
  create(dto: CreateCategoryDto) {
    return this.prisma.category.create({ data: dto });
  }
}
