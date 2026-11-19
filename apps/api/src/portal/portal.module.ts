import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';
import { PortalScopeService } from './portal.service';

/** Store Portal module - scoped views for STORE_MANAGER + AREA_MANAGER. */
@Module({
  controllers: [PortalController],
  providers:   [PortalScopeService],
  exports:     [PortalScopeService],
})
export class PortalModule {}
