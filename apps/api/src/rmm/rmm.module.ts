import { Module } from '@nestjs/common';
import { RmmController } from './rmm.controller';
import { RmmService } from './rmm.service';
import { RmmGateway } from './rmm.gateway';
import { DiscoveryModule } from '../discovery/discovery.module';

@Module({
  imports: [DiscoveryModule],   // exports ApiKeysService used by the WS gateway
  controllers: [RmmController],
  providers: [RmmService, RmmGateway],
  exports: [RmmGateway],
})
export class RmmModule {}
