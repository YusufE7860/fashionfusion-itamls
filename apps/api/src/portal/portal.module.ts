import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';
import { PortalScopeService } from './portal.service';
import { NotifyModule } from '../notify/notify.module';

/** Store Portal module - scoped views for STORE_MANAGER + AREA_MANAGER.
 *  Imports NotifyModule so new-call creation can push to assigned techs. */
@Module({
  imports:     [NotifyModule],
  controllers: [PortalController],
  providers:   [PortalScopeService],
  exports:     [PortalScopeService],
})
export class PortalModule {}
