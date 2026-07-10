import { Module } from '@nestjs/common';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { BackupsAgentController } from './backups-agent.controller';
import { BackupsRetentionService } from './backups-retention.service';
import { DiscoveryModule } from '../discovery/discovery.module';

@Module({
  imports: [DiscoveryModule],
  controllers: [BackupsController, BackupsAgentController],
  providers: [BackupsService, BackupsRetentionService],
  exports: [BackupsService],
})
export class BackupsModule {}
