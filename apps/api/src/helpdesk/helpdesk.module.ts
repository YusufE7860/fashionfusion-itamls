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
import { BusinessHoursService } from './business-hours.service';
import { HelpdeskV3Service } from './helpdesk-v3.service';
import { HelpdeskV3Controller } from './helpdesk-v3.controller';
import { DiscoveryModule } from '../discovery/discovery.module';

@Module({
  imports: [DiscoveryModule],
  controllers: [
    TicketsController, HelpdeskExternalController, PublicHelpdeskController,
    HelpdeskWebhooksController, CannedResponsesController, HelpdeskV3Controller,
  ],
  providers: [
    TicketsService, HelpdeskAdminService, TicketsCron, HelpdeskService,
    EmailIngestService, HelpdeskRoutingService, HelpdeskWebhooksService,
    CannedResponsesService, BusinessHoursService, HelpdeskV3Service,
  ],
  exports: [TicketsService],
})
export class HelpdeskModule {}
