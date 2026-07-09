import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DispatchLineDto, GenerateOrderDto, ReceiveLineDto, TonerOrdersService } from './toner-orders.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('toner/orders')
export class TonerOrdersController {
  constructor(private svc: TonerOrdersService) {}

  @Get()
  @RequirePermissions(Permissions.TonerOrderCreate)
  list() { return this.svc.list(); }

  @Get(':id')
  @RequirePermissions(Permissions.TonerOrderCreate)
  byId(@Param('id') id: string) { return this.svc.byId(id); }

  @Post('generate')
  @RequirePermissions(Permissions.TonerOrderCreate)
  generate(@Body() dto: GenerateOrderDto) { return this.svc.generate(dto); }

  @Post('lines/:lineId/dispatch')
  @RequirePermissions(Permissions.TonerOrderDispatch)
  dispatchLine(@Param('lineId') lineId: string, @Body() dto: DispatchLineDto) {
    return this.svc.dispatchLine(lineId, dto);
  }

  @Post(':id/stores/:storeId/dispatch')
  @RequirePermissions(Permissions.TonerOrderDispatch)
  dispatchStore(@Param('id') id: string, @Param('storeId') storeId: string, @Body() dto: DispatchLineDto) {
    return this.svc.dispatchStore(id, storeId, dto);
  }

  @Post('lines/:lineId/receive')
  @RequirePermissions(Permissions.TonerOrderReceive)
  receiveLine(@Param('lineId') lineId: string, @Body() dto: ReceiveLineDto) {
    return this.svc.receiveLine(lineId, dto);
  }

  @Post(':id/close')
  @RequirePermissions(Permissions.TonerOrderCreate)
  close(@Param('id') id: string) { return this.svc.close(id); }

  @Post(':id/cancel')
  @RequirePermissions(Permissions.TonerOrderCreate)
  cancel(@Param('id') id: string) { return this.svc.cancel(id); }
}
