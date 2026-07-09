import { Controller, Get, Query } from '@nestjs/common';
import { PriceLookupService } from './price-lookup.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('price-lookup')
export class PriceLookupController {
  constructor(private svc: PriceLookupService) {}

  @Get()
  @RequirePermissions(Permissions.CatalogWrite)
  lookup(@Query('manufacturer') manufacturer: string, @Query('model') model: string) {
    return this.svc.lookup(manufacturer ?? '', model ?? '');
  }
}
