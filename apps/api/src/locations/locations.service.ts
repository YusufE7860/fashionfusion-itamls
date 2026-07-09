import { Injectable, NotFoundException } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

export class CreateLocationDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() type!: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() parentId?: string;
}

@Injectable()
export class LocationsService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.location.findMany({ orderBy: { code: 'asc' } });
  }

  async byId(id: string) {
    const loc = await this.prisma.location.findUnique({ where: { id }, include: { store: true } });
    if (!loc) throw new NotFoundException();
    return loc;
  }

  create(dto: CreateLocationDto) {
    return this.prisma.location.create({ data: dto });
  }
}
