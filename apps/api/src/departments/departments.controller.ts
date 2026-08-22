import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { DepartmentsService, DepartmentDto } from './departments.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('departments')
export class DepartmentsController {
  constructor(private svc: DepartmentsService) {}

  @Get()
  @RequirePermissions(Permissions.DepartmentsRead)
  list(@Query('includeInactive') includeInactive?: string) {
    return this.svc.list(includeInactive === 'true');
  }

  @Post()
  @RequirePermissions(Permissions.DepartmentsManage)
  create(@Body() dto: DepartmentDto) { return this.svc.create(dto); }

  @Patch(':id')
  @RequirePermissions(Permissions.DepartmentsManage)
  update(@Param('id') id: string, @Body() dto: DepartmentDto) { return this.svc.update(id, dto); }

  @Delete(':id')
  @RequirePermissions(Permissions.DepartmentsManage)
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
