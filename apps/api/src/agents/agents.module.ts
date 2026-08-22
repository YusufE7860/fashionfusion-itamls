import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { DiscoveryModule } from '../discovery/discovery.module';
import { PinPadsModule } from '../pinpads/pinpads.module';

@Module({
  imports: [DiscoveryModule, PinPadsModule],  // ApiKeysService + PinPadsService
  controllers: [AgentsController],
  providers: [AgentsService],
})
export class AgentsModule {}
