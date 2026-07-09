import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { AssetsImportController } from './assets-import.controller';
import { AssetsImportService } from './assets-import.service';
import { DecommissionController } from './decommission.controller';

@Module({
  controllers: [AssetsController, StockController, AssetsImportController, DecommissionController],
  providers: [AssetsService, StockService, AssetsImportService],
  exports: [AssetsService, StockService],
})
export class InventoryModule {}
