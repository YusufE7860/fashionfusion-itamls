import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AdjustStockDto, StockService, UpsertStockDto } from './stock.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('stock')
export class StockController {
  constructor(private svc: StockService) {}

  @Get()
  @RequirePermissions(Permissions.StockRead)
  byLocation(@Query('locationId') locationId?: string) {
    return this.svc.byLocation(locationId);
  }

  @Get('low')
  @RequirePermissions(Permissions.StockRead)
  low() { return this.svc.lowStock(); }

  @Post()
  @RequirePermissions(Permissions.StockWrite)
  upsert(@Body() dto: UpsertStockDto) { return this.svc.upsert(dto); }

  @Post('adjust')
  @RequirePermissions(Permissions.StockWrite)
  adjust(@Body() dto: AdjustStockDto) { return this.svc.adjust(dto); }
}
