import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import { ApiKeysController } from './api-keys.controller';
import { DiscoveryService } from './discovery.service';
import { ApiKeysService } from './api-keys.service';

@Module({
  controllers: [DiscoveryController, ApiKeysController],
  providers: [DiscoveryService, ApiKeysService],
})
export class DiscoveryModule {}
