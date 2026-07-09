import { Module } from '@nestjs/common';
import { GrvController } from './grv.controller';
import { GrvService } from './grv.service';
import { IbtController } from './ibt.controller';
import { IbtService } from './ibt.service';
import { DispatchNoteService } from './dispatch-note.service';

@Module({
  controllers: [GrvController, IbtController],
  providers: [GrvService, IbtService, DispatchNoteService],
})
export class LogisticsModule {}
