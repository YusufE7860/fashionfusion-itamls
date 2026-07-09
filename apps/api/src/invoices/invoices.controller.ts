import {
  BadRequestException, Body, Controller, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { InvoicesService, ListInvoicesQuery } from './invoices.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('invoices')
export class InvoicesController {
  constructor(private svc: InvoicesService) {}

  @Get()
  @RequirePermissions(Permissions.AssetsRead)
  list(@Query() q: ListInvoicesQuery) {
    return this.svc.list(q);
  }

  @Get(':id')
  @RequirePermissions(Permissions.AssetsRead)
  byId(@Param('id') id: string) {
    return this.svc.byId(id);
  }

  @Get(':id/download')
  @RequirePermissions(Permissions.AssetsRead)
  async download(@Param('id') id: string, @Res() res: Response) {
    const { stream, inv } = await this.svc.streamInline(id);
    const ext = inv.fileUrl?.split('.').pop() ?? 'bin';
    res.setHeader('Content-Disposition', `inline; filename="${inv.docNo}.${ext}"`);
    stream.pipe(res);
  }

  @Post()
  @RequirePermissions(Permissions.SuppliersManage)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: {
      docNo: string; supplierId: string; invoiceDate: string; totalCents: string;
      linkedAssetId?: string; linkedGrvId?: string; linkedPoId?: string;
    },
  ) {
    if (!file) throw new BadRequestException('file is required (multipart field name "file")');
    return this.svc.create({
      docNo: body.docNo,
      supplierId: body.supplierId,
      invoiceDate: body.invoiceDate,
      totalCents: Number(body.totalCents),
      linkedAssetId: body.linkedAssetId || undefined,
      linkedGrvId: body.linkedGrvId || undefined,
      linkedPoId: body.linkedPoId || undefined,
      file: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer,
      },
    });
  }
}
