import { Injectable } from '@nestjs/common';
import { IsInt, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

export class CreateSupplierDto {
  @IsString() name!: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() taxNumber?: string;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsInt() leadTimeDays?: number;
}

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}
  list() { return this.prisma.supplier.findMany({ orderBy: { name: 'asc' } }); }
  create(dto: CreateSupplierDto) { return this.prisma.supplier.create({ data: dto }); }
}
