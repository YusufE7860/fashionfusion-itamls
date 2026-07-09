import { Module } from '@nestjs/common';
import { RepairsController } from './repairs.controller';
import { RepairsService } from './repairs.service';
import { WarrantyController } from './warranty.controller';
import { WarrantyService } from './warranty.service';

@Module({
  controllers: [RepairsController, WarrantyController],
  providers: [RepairsService, WarrantyService],
})
export class ServiceModule {}
