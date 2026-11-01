import { Controller, Post, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LegacyImportService } from './legacy-import.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

/**
 * In-app uploader for historical ticket imports. Lets an admin drop an .xlsx
 * exported from the old ManageEngine helpdesk straight through the admin UI
 * instead of needing an SSH session + ts-node command.
 */
@Controller('helpdesk/imports')
export class LegacyImportController {
  constructor(private svc: LegacyImportService) {}

  @Post('manageengine')
  @RequirePermissions(Permissions.TicketsManageCategories)
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 50 * 1024 * 1024 },  // 50MB cap — plenty for an xlsx with 50k rows
  }))
  async importMe(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file required (multipart field "file")');
    if (!/\.xlsx$/i.test(file.originalname)) {
      throw new BadRequestException('xlsx file required');
    }
    return this.svc.importManageEngineXlsx(file.buffer);
  }
}
