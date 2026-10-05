import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { HelpdeskWebhooksService } from './webhooks.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('helpdesk/webhooks')
export class HelpdeskWebhooksController {
  constructor(private svc: HelpdeskWebhooksService) {}

  @Get() @RequirePermissions(Permissions.TicketsManageWebhooks)
  list() { return this.svc.list(); }

  @Post() @RequirePermissions(Permissions.TicketsManageWebhooks)
  create(@Body() dto: { name: string; url: string; events?: string; secret?: string }) { return this.svc.create(dto); }

  @Patch(':id') @RequirePermissions(Permissions.TicketsManageWebhooks)
  update(@Param('id') id: string, @Body() dto: any) { return this.svc.update(id, dto); }

  @Delete(':id') @RequirePermissions(Permissions.TicketsManageWebhooks)
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  @Get(':id/deliveries') @RequirePermissions(Permissions.TicketsManageWebhooks)
  recent(@Param('id') id: string) { return this.svc.recentDeliveries(id); }

  @Post(':id/test') @RequirePermissions(Permissions.TicketsManageWebhooks)
  test(@Param('id') id: string) { return this.svc.testDelivery(id); }
}
