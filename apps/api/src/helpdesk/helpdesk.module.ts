import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { HelpdeskExternalController } from './helpdesk.controller';
import { PublicHelpdeskController } from './public-api.controller';
import { HelpdeskWebhooksController } from './webhooks.controller';
import { CannedResponsesController } from './canned.controller';
import { CannedResponsesService } from './canned.service';
import { HelpdeskService } from './helpdesk.service';
import { TicketsService } from './tickets.service';
import { HelpdeskAdminService } from './categories.service';
import { TicketsCron } from './tickets.cron';
import { EmailIngestService } from './email-ingest.service';
import { HelpdeskRoutingService } from './routing.service';
import { HelpdeskWebhooksService } from './webhooks.service';
import { DiscoveryModule } from '../discovery/discovery.module';

/**
 * Native tickets (primary) plus the legacy external-helpdesk integration
 * controller (kept for Kaseya / Freshdesk sync features). Both live under
 * /helpdesk but the legacy one is scoped to /helpdesk/external.
 */
@Module({
  imports: [DiscoveryModule], // for ApiKeysService (shared across store PCs + Ops app)
  controllers: [TicketsController, HelpdeskExternalController, PublicHelpdeskController, HelpdeskWebhooksController, CannedResponsesController],
  providers: [
    TicketsService, HelpdeskAdminService, TicketsCron, HelpdeskService,
    EmailIngestService, HelpdeskRoutingService, HelpdeskWebhooksService,
    CannedResponsesService,
  ],
  exports: [TicketsService],
})
export class HelpdeskModule {}
