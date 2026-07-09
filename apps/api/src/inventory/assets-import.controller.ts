import {
  BadRequestException, Body, Controller, Get, Post, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AssetsImportService } from './assets-import.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('assets/import')
export class AssetsImportController {
  constructor(private svc: AssetsImportService) {}

  @Get('template.csv')
  @RequirePermissions(Permissions.AssetsWrite)
  template(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="assets-import-template.csv"');
    res.send(this.svc.templateCsv());
  }

  @Post('dry-run')
  @RequirePermissions(Permissions.AssetsWrite)
  @UseInterceptors(FileInterceptor('file'))
  dryRun(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: { csv?: string }) {
    const csv = file ? file.buffer.toString('utf-8') : body.csv;
    if (!csv) throw new BadRequestException('CSV not provided');
    return this.svc.dryRun(csv);
  }

  @Post('commit')
  @RequirePermissions(Permissions.AssetsWrite)
  @UseInterceptors(FileInterceptor('file'))
  commit(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: { csv?: string }, @CurrentUser('sub') uid: string) {
    const csv = file ? file.buffer.toString('utf-8') : body.csv;
    if (!csv) throw new BadRequestException('CSV not provided');
    return this.svc.commit(csv, uid);
  }
}
