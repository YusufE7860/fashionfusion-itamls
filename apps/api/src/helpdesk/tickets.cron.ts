import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TicketsService } from './tickets.service';

@Injectable()
export class TicketsCron {
  private readonly logger = new Logger(TicketsCron.name);
  constructor(private tickets: TicketsService) {}

  /** Every 5 minutes: mark tickets that have blown their SLA deadlines. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async slaSweep() {
    try {
      const r = await this.tickets.runSlaBreachSweep();
      if (r.responseBreaches || r.resolveBreaches) {
        this.logger.warn(`SLA sweep flagged ${r.responseBreaches} response + ${r.resolveBreaches} resolve breaches`);
      }
    } catch (e: any) {
      this.logger.error(`SLA sweep failed: ${e.message ?? e}`);
    }
  }
}
