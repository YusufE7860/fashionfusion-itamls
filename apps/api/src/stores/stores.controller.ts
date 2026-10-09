import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { BulkCreateStoresDto, CreateStoreDto, StoresService, TransferAssetsDto, UpdateStoreDto } from './stores.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('stores')
export class StoresController {
  constructor(private svc: StoresService) {}

  @Get() @RequirePermissions(Permissions.StoresRead) list() { return this.svc.list(); }
  @Get(':id') @RequirePermissions(Permissions.StoresRead) byId(@Param('id') id: string) { return this.svc.byId(id); }

  @Post()
  @RequirePermissions(Permissions.StoresWrite)
  create(@Body() dto: CreateStoreDto) { return this.svc.create(dto); }

  @Post('bulk')
  @RequirePermissions(Permissions.StoresWrite)
  bulk(@Body() dto: BulkCreateStoresDto) { return this.svc.bulkCreate(dto); }

  @Patch(':id')
  @RequirePermissions(Permissions.StoresWrite)
  update(@Param('id') id: string, @Body() dto: UpdateStoreDto) { return this.svc.update(id, dto); }

  @Delete(':id')
  @RequirePermissions(Permissions.StoresWrite)
  remove(@Param('id') id: string, @Query('force') force?: string) {
    return this.svc.remove(id, { force: force === 'true' });
  }

  @Post('transfer-assets')
  @RequirePermissions(Permissions.StoresWrite)
  transfer(@Body() dto: TransferAssetsDto, @Req() req: any) {
    return this.svc.transferAssets(dto, req.user?.sub);
  }
}
