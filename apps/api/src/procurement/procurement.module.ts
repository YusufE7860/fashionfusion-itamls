import { Module } from '@nestjs/common';
import { PrController } from './pr.controller';
import { PrService } from './pr.service';
import { PoController } from './po.controller';
import { PoService } from './po.service';

@Module({
  controllers: [PrController, PoController],
  providers: [PrService, PoService],
})
export class ProcurementModule {}
