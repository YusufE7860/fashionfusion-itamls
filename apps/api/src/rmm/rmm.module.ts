import { Module } from '@nestjs/common';
import { RmmController } from './rmm.controller';
import { RmmService } from './rmm.service';
import { RmmGateway } from './rmm.gateway';

@Module({
  controllers: [RmmController],
  providers: [RmmService, RmmGateway],
  exports: [RmmGateway],
})
export class RmmModule {}
