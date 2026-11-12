import { Module } from '@nestjs/common';
import { EquipmentIncidentsController } from './equipment-incidents.controller';
import { EquipmentIncidentsService } from './equipment-incidents.service';

@Module({
  controllers: [EquipmentIncidentsController],
  providers: [EquipmentIncidentsService],
})
export class IncidentsModule {}
