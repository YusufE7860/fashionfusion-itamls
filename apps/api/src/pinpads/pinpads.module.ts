import { Module } from '@nestjs/common';
import { PinPadsController } from './pinpads.controller';
import { PinPadsService } from './pinpads.service';
import { PinPadsCron } from './pinpads.cron';

@Module({
  controllers: [PinPadsController],
  providers: [PinPadsService, PinPadsCron],
  exports: [PinPadsService],
})
export class PinPadsModule {}
