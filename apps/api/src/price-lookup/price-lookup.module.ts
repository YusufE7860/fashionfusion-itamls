import { Module } from '@nestjs/common';
import { PriceLookupController } from './price-lookup.controller';
import { PriceLookupService } from './price-lookup.service';

@Module({
  controllers: [PriceLookupController],
  providers: [PriceLookupService],
  exports: [PriceLookupService],
})
export class PriceLookupModule {}
