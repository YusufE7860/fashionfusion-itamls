import { Module } from '@nestjs/common';
import { RegionsController, AreaManagersController } from './org.controller';
import { RegionsService, AreaManagersService } from './org.service';

@Module({
  controllers: [RegionsController, AreaManagersController],
  providers: [RegionsService, AreaManagersService],
  exports: [RegionsService, AreaManagersService],
})
export class OrgModule {}
