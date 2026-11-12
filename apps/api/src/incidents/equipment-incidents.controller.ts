import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import {
  CreateIncidentDto, EquipmentIncidentsService, UpdateIncidentDto,
} from './equipment-incidents.service';
import { StorageService } from '../storage/storage.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('equipment-incidents')
export class EquipmentIncidentsController {
  constructor(
    private svc: EquipmentIncidentsService,
    private storage: StorageService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.AssetsRead)
  list(
    @Query('status')  status?: string,
    @Query('storeId') storeId?: string,
    @Query('search')  search?: string,
  ) {
    return this.svc.list({ status, storeId, search });
  }

  @Get('summary')
  @RequirePermissions(Permissions.AssetsRead)
  summary() { return this.svc.summary(); }

  @Get(':id')
  @RequirePermissions(Permissions.AssetsRead)
  byId(@Param('id') id: string) { return this.svc.byId(id); }

  @Post()
  @RequirePermissions(Permissions.AssetsWrite)
  create(@Body() dto: CreateIncidentDto, @Req() req: any) {
    return this.svc.create(dto, req.user?.sub);
  }

  @Patch(':id')
  @RequirePermissions(Permissions.AssetsWrite)
  update(@Param('id') id: string, @Body() dto: UpdateIncidentDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permissions.AssetsWrite)
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  /**
   * Upload a scanned AOD document. Accepts multipart form data with a
   * single "file" field. Caps at 10 MB — AOD scans are one or two pages.
   */
  @Post(':id/aod')
  @RequirePermissions(Permissions.AssetsWrite)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadAod(@Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file required');
    const ext = (file.originalname.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '').toLowerCase();
    const key = `incidents/${id}/aod-${randomUUID()}${ext}`;
    await this.storage.putObject(key, file.buffer, file.mimetype ?? 'application/octet-stream');
    return this.svc.attachAod(id, key);
  }
}
