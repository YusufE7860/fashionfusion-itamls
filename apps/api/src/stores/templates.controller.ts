import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateTemplateDto, TemplatesService, UpdateTemplateDto, UpsertItemDto } from './templates.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('store-templates')
export class TemplatesController {
  constructor(private svc: TemplatesService) {}

  @Get() list() { return this.svc.list(); }
  @Get(':id') byId(@Param('id') id: string) { return this.svc.byId(id); }

  @Post() @RequirePermissions(Permissions.StoresWrite)
  create(@Body() dto: CreateTemplateDto) { return this.svc.create(dto); }

  @Patch(':id') @RequirePermissions(Permissions.StoresWrite)
  update(@Param('id') id: string, @Body() dto: UpdateTemplateDto) { return this.svc.update(id, dto); }

  @Delete(':id') @RequirePermissions(Permissions.StoresWrite)
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  @Post(':id/items') @RequirePermissions(Permissions.StoresWrite)
  upsertItem(@Param('id') id: string, @Body() dto: UpsertItemDto) { return this.svc.upsertItem(id, dto); }

  @Delete(':id/items/:itemId') @RequirePermissions(Permissions.StoresWrite)
  removeItem(@Param('itemId') itemId: string) { return this.svc.removeItem(itemId); }
}
