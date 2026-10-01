import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { HelpdeskExternalController } from './helpdesk.controller';
import { HelpdeskService } from './helpdesk.service';
import { TicketsService } from './tickets.service';
import { HelpdeskAdminService } from './categories.service';
import { TicketsCron } from './tickets.cron';
import { EmailIngestService } from './email-ingest.service';

/**
 * Native tickets (primary) plus the legacy external-helpdesk integration
 * controller (kept for Kaseya / Freshdesk sync features). Both live under
 * /helpdesk but the legacy one is scoped to /helpdesk/external.
 */
@Module({
  controllers: [TicketsController, HelpdeskExternalController],
  providers: [TicketsService, HelpdeskAdminService, TicketsCron, HelpdeskService, EmailIngestService],
  exports: [TicketsService],
})
export class HelpdeskModule {}
