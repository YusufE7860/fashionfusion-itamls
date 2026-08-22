import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinPadsService } from './pinpads.service';

@Injectable()
export class PinPadsCron {
  private readonly logger = new Logger(PinPadsCron.name);
  constructor(private svc: PinPadsService) {}

  // Once a day, first thing (server time) — mark pads MISSING if the till
  // hasn't reported in 7 days.
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async runMissingSweep() {
    try {
      const { markedMissing } = await this.svc.markStaleMissing();
      if (markedMissing > 0) {
        this.logger.log(`Marked ${markedMissing} PIN pad(s) MISSING after 7-day silence`);
      }
    } catch (e: any) {
      this.logger.error(`Missing sweep failed: ${e.message ?? e}`);
    }
  }
}
