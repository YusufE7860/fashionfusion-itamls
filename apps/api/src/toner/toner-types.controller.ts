import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateTonerTypeDto, TonerTypesService, UpdateTonerTypeDto } from './toner-types.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('toner/types')
export class TonerTypesController {
  constructor(private svc: TonerTypesService) {}

  @Get()
  @RequirePermissions(Permissions.TonerManage)
  list() { return this.svc.list(); }

  @Post()
  @RequirePermissions(Permissions.TonerManage)
  create(@Body() dto: CreateTonerTypeDto) { return this.svc.create(dto); }

  @Patch(':id')
  @RequirePermissions(Permissions.TonerManage)
  update(@Param('id') id: string, @Body() dto: UpdateTonerTypeDto) { return this.svc.update(id, dto); }

  @Post(':id/adjust-stock')
  @RequirePermissions(Permissions.TonerManage)
  adjust(@Param('id') id: string, @Body() body: { delta: number }) {
    return this.svc.adjustStock(id, body.delta);
  }
}
