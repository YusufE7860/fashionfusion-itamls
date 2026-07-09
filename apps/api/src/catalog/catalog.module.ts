import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { SkusController } from './skus.controller';
import { SkusService } from './skus.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  controllers: [CategoriesController, SkusController, SuppliersController],
  providers: [CategoriesService, SkusService, SuppliersService],
  exports: [CategoriesService, SkusService, SuppliersService],
})
export class CatalogModule {}
