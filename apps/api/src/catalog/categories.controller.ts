import { Body, Controller, Get, Post } from '@nestjs/common';
import { CategoriesService, CreateCategoryDto } from './categories.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('categories')
export class CategoriesController {
  constructor(private svc: CategoriesService) {}
  @Get() list() { return this.svc.list(); }
  @Post() @RequirePermissions(Permissions.CatalogWrite) create(@Body() dto: CreateCategoryDto) { return this.svc.create(dto); }
}
