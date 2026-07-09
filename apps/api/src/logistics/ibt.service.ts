import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AssetStatus, IbtStatus } from '../shared';

export class IbtLineDto {
  @IsOptional() @IsString() assetId?: string;
  @IsString() skuId!: string;
  @IsInt() @Min(1) qty!: number;
}
export class CreateIbtDto {
  @IsString() fromLocationId!: string;
  @IsString() toLocationId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => IbtLineDto) lines!: IbtLineDto[];
  @IsOptional() @IsString() notes?: string;
}

@Injectable()
export class IbtService {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  list() {
    return this.prisma.ibt.findMany({
      orderBy: { createdAt: 'desc' },
      include: { fromLoc: true, toLoc: true, requestedBy: true, lines: { include: { sku: true, asset: true } } },
      take: 100,
    });
  }

  private async nextCode() {
    const count = await this.prisma.ibt.count();
    return `IBT-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateIbtDto, requesterId: string) {
    const code = await this.nextCode();
    return this.prisma.ibt.create({
      data: {
        code,
        fromLocationId: dto.fromLocationId,
        toLocationId: dto.toLocationId,
        requestedById: requesterId,
        status: IbtStatus.Requested,
        notes: dto.notes,
        lines: { create: dto.lines.map((l) => ({ assetId: l.assetId, skuId: l.skuId, qty: l.qty })) },
      },
      include: { lines: true },
    });
  }

  async approve(id: string, approverId: string) {
    const ibt = await this.prisma.ibt.findUnique({ where: { id } });
    if (!ibt) throw new NotFoundException();
    if (ibt.status !== IbtStatus.Requested) throw new BadRequestException('Not in REQUESTED');
    return this.prisma.ibt.update({
      where: { id },
      data: { status: IbtStatus.Approved, approvedById: approverId },
    });
  }

  async dispatch(id: string, dispatcherId: string, opts: { courier?: string; trackingNo?: string; boxNumbers?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const ibt = await tx.ibt.findUnique({
        where: { id }, include: { lines: true },
      });
      if (!ibt) throw new NotFoundException();
      if (ibt.status !== IbtStatus.Approved) throw new BadRequestException('Not APPROVED');
      // Mark assets in transit and write history
      for (const line of ibt.lines) {
        if (line.assetId) {
          await tx.asset.update({
            where: { id: line.assetId },
            data: { status: AssetStatus.InTransit, locationId: ibt.fromLocationId },
          });
          await tx.assetHistory.create({
            data: {
              assetId: line.assetId,
              eventType: 'DISPATCHED',
              fromLocationId: ibt.fromLocationId,
              toLocationId: ibt.toLocationId,
              refTable: 'ibt',
              refId: ibt.id,
              actorId: dispatcherId,
            },
          });
        }
      }
      return tx.ibt.update({
        where: { id },
        data: {
          status: IbtStatus.Dispatched,
          dispatchedById: dispatcherId,
          courier: opts.courier,
          trackingNo: opts.trackingNo,
          boxNumbers: opts.boxNumbers,
          sentAt: new Date(),
        },
      });
    });
  }

  async receive(id: string, actorId: string, opts: { signatureDataUrl?: string; signedBy?: string } = {}) {
    // If a signature is provided, push it to MinIO first
    let signatureUrl: string | undefined;
    if (opts.signatureDataUrl?.startsWith('data:image/')) {
      const [meta, b64] = opts.signatureDataUrl.split(',');
      const mime = meta.match(/data:(.*?);base64/)?.[1] ?? 'image/png';
      const buf = Buffer.from(b64, 'base64');
      const ext = mime.split('/')[1] ?? 'png';
      const key = this.storage.generateObjectKey(`signature.${ext}`, 'signatures');
      await this.storage.putObject(key, buf, mime);
      signatureUrl = key;
    }

    return this.prisma.$transaction(async (tx) => {
      const ibt = await tx.ibt.findUnique({
        where: { id },
        include: { lines: true, toLoc: { include: { store: true } } },
      });
      if (!ibt) throw new NotFoundException();
      if (ibt.status !== IbtStatus.Dispatched && ibt.status !== IbtStatus.InTransit) {
        throw new BadRequestException('Not in transit');
      }
      for (const line of ibt.lines) {
        if (line.assetId) {
          await tx.asset.update({
            where: { id: line.assetId },
            data: {
              status: AssetStatus.InStore,
              locationId: ibt.toLocationId,
            },
          });
          await tx.assetHistory.create({
            data: {
              assetId: line.assetId,
              eventType: 'RECEIVED',
              fromLocationId: ibt.fromLocationId,
              toLocationId: ibt.toLocationId,
              refTable: 'ibt',
              refId: ibt.id,
              actorId,
            },
          });
        } else {
          // Move stock for non-serialised
          await tx.stock.upsert({
            where: { skuId_locationId: { skuId: line.skuId, locationId: ibt.fromLocationId } },
            create: { skuId: line.skuId, locationId: ibt.fromLocationId, qtyOnHand: 0 },
            update: { qtyOnHand: { decrement: line.qty } },
          });
          await tx.stock.upsert({
            where: { skuId_locationId: { skuId: line.skuId, locationId: ibt.toLocationId } },
            create: { skuId: line.skuId, locationId: ibt.toLocationId, qtyOnHand: line.qty },
            update: { qtyOnHand: { increment: line.qty } },
          });
          await tx.stockMovement.create({
            data: {
              skuId: line.skuId,
              fromLocationId: ibt.fromLocationId,
              toLocationId: ibt.toLocationId,
              qty: line.qty,
              reason: 'IBT',
              refTable: 'ibt',
              refId: ibt.id,
            },
          });
        }
      }
      // Record the dispatch acknowledgement
      const storeId = ibt.toLoc?.store?.id;
      if (storeId) {
        const dCount = await tx.dispatch.count();
        await tx.dispatch.create({
          data: {
            code: `DN-${new Date().getFullYear()}-${String(dCount + 1).padStart(5, '0')}`,
            ibtId: ibt.id,
            storeId,
            technicianId: ibt.dispatchedById ?? actorId,
            signedBy: opts.signedBy,
            signatureUrl,
            receivedAt: new Date(),
          },
        });
      }

      return tx.ibt.update({
        where: { id },
        data: { status: IbtStatus.Received, receivedAt: new Date() },
      });
    });
  }
}
