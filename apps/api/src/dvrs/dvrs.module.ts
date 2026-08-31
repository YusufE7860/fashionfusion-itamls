import { Module } from '@nestjs/common';
import { DvrsController } from './dvrs.controller';
import { DvrsService } from './dvrs.service';

@Module({
  controllers: [DvrsController],
  providers: [DvrsService],
})
export class DvrsModule {}
