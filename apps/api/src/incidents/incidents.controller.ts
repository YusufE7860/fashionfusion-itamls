import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { IncidentsService } from './incidents.service';
import { RequirePermissions, Public } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller()
export class IncidentsController {
  constructor(private svc: IncidentsService) {}

  // Unauthenticated status page feed
  @Public() @Get('public/status')
  publicStatus() { return this.svc.publicStatus(); }

  // Admin — list + CRUD. Reuses TicketsReports perm (anyone who can read reports can see; writes gated).
  @Get('incidents')
  @RequirePermissions(Permissions.TicketsReports)
  list(@Query('includeResolved') inc?: string) { return this.svc.list(inc === 'true'); }

  @Get('incidents/:id')
  @RequirePermissions(Permissions.TicketsReports)
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post('incidents')
  @RequirePermissions(Permissions.TicketsManageCategories)
  create(@Body() body: any, @Req() req: any) { return this.svc.create(body, req.user?.sub); }

  @Post('incidents/:id/updates')
  @RequirePermissions(Permissions.TicketsManageCategories)
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.addUpdate(id, body, req.user?.sub);
  }

  @Delete('incidents/:id')
  @RequirePermissions(Permissions.TicketsManageCategories)
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
