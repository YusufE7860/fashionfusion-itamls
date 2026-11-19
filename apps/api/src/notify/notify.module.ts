import { Module } from '@nestjs/common';
import { NotifyController } from './notify.controller';
import { NotifyService } from './notify.service';

/** Web Push notifications. Exports NotifyService so other modules (e.g.
 *  PortalModule for new-ticket pushes) can call notifyNewTicket(). */
@Module({
  controllers: [NotifyController],
  providers: [NotifyService],
  exports: [NotifyService],
})
export class NotifyModule {}
