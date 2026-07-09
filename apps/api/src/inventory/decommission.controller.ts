import {
  BadRequestException, Body, Controller, Get, Param, Post, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('assets/:id/decommission')
export class DecommissionController {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  @Get()
  @RequirePermissions(Permissions.AssetsRead)
  byAsset(@Param('id') id: string) {
    return this.prisma.decommission.findUnique({ where: { assetId: id } });
  }

  @Post()
  @RequirePermissions(Permissions.AssetsDispose)
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'dataWipeCert', maxCount: 1 },
    { name: 'disposalSlip', maxCount: 1 },
  ]))
  async decommission(
    @Param('id') id: string,
    @Body() body: { reason: string; notes?: string; disposalVendor?: string },
    @UploadedFiles() files: { dataWipeCert?: Express.Multer.File[]; disposalSlip?: Express.Multer.File[] },
    @CurrentUser('sub') uid: string,
  ) {
    if (!body.reason) throw new BadRequestException('reason is required');
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new BadRequestException('Asset not found');
    if (asset.status === 'DISPOSED') throw new BadRequestException('Asset already disposed');

    let dataWipeCertUrl: string | undefined;
    let disposalSlipUrl: string | undefined;
    const wipe = files?.dataWipeCert?.[0];
    const slip = files?.disposalSlip?.[0];
    if (wipe) {
      const key = this.storage.generateObjectKey(wipe.originalname, 'decommission');
      await this.storage.putObject(key, wipe.buffer, wipe.mimetype);
      dataWipeCertUrl = key;
    }
    if (slip) {
      const key = this.storage.generateObjectKey(slip.originalname, 'decommission');
      await this.storage.putObject(key, slip.buffer, slip.mimetype);
      disposalSlipUrl = key;
    }

    return this.prisma.$transaction(async (tx) => {
      const dec = await tx.decommission.create({
        data: {
          assetId: id,
          reason: body.reason,
          notes: body.notes,
          disposalVendor: body.disposalVendor,
          dataWipeCertUrl,
          disposalSlipUrl,
          signedOffById: uid,
        },
      });
      await tx.asset.update({ where: { id }, data: { status: 'DISPOSED', currentValueCents: 0 } });
      await tx.assetHistory.create({
        data: {
          assetId: id,
          eventType: 'RETIRED',
          refTable: 'decommission',
          refId: dec.id,
          actorId: uid,
          notes: `Decommissioned (${body.reason})${body.notes ? ': ' + body.notes : ''}`,
        },
      });
      return dec;
    });
  }
}
