import { Module } from '@nestjs/common';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { EquipmentIncidentsController } from './equipment-incidents.controller';
import { EquipmentIncidentsService } from './equipment-incidents.service';

/**
 * Unified incidents module.
 *
 * Two kinds of "incident" live under this umbrella and share the folder:
 *   - IncidentsController     — IT outage events shown on the public status
 *                                page (/public/status) and admin incident log.
 *   - EquipmentIncidentsController — store-side equipment damage / loss /
 *                                AOD tracking (new in Nov 2026).
 *
 * They're unrelated models (Incident vs EquipmentIncident) but share enough
 * context to live in one feature module — easier to find, one import in
 * app.module.
 */
@Module({
  controllers: [IncidentsController, EquipmentIncidentsController],
  providers:   [IncidentsService,   EquipmentIncidentsService],
})
export class IncidentsModule {}
