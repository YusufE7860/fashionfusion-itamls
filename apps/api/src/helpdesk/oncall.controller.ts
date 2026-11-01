import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { OnCallService } from './oncall.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('oncall')
export class OnCallController {
  constructor(private svc: OnCallService) {}

  @Get('shifts')
  @RequirePermissions(Permissions.TicketsRead)
  list(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.listShifts({
      from: from ? new Date(from) : undefined,
      to:   to   ? new Date(to)   : undefined,
    });
  }

  @Post('shifts')
  @RequirePermissions(Permissions.TicketsAssign)
  create(@Body() body: any, @Req() req: any) {
    return this.svc.createShift(body, req.user?.sub);
  }

  @Patch('shifts/:id')
  @RequirePermissions(Permissions.TicketsAssign)
  update(@Param('id') id: string, @Body() body: any) {
    return this.svc.updateShift(id, body);
  }

  @Delete('shifts/:id')
  @RequirePermissions(Permissions.TicketsAssign)
  remove(@Param('id') id: string) { return this.svc.deleteShift(id); }

  @Get('dashboard')
  @RequirePermissions(Permissions.TicketsRead)
  dashboard(@Query('scope') scope?: string) {
    return this.svc.currentAndUpcoming(scope);
  }

  @Post('broadcast')
  @RequirePermissions(Permissions.TicketsAssign)
  broadcast() { return this.svc.broadcastNow(); }
}
