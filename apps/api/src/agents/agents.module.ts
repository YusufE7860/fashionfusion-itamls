import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { DiscoveryModule } from '../discovery/discovery.module';

@Module({
  imports: [DiscoveryModule],  // for ApiKeysService
  controllers: [AgentsController],
  providers: [AgentsService],
})
export class AgentsModule {}
