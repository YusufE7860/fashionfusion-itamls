import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditsService, CreateAuditDto } from './audits.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('audits')
export class AuditsController {
  constructor(private svc: AuditsService) {}

  @Get()
  @RequirePermissions(Permissions.StoresAudit)
  list(@Query('storeId') storeId?: string) {
    return this.svc.list(storeId);
  }

  @Get(':id')
  @RequirePermissions(Permissions.StoresAudit)
  byId(@Param('id') id: string) {
    return this.svc.byId(id);
  }

  @Get(':id/summary')
  @RequirePermissions(Permissions.StoresAudit)
  summary(@Param('id') id: string) {
    return this.svc.summary(id);
  }

  @Post()
  @RequirePermissions(Permissions.StoresAudit)
  create(@Body() dto: CreateAuditDto, @CurrentUser('sub') uid: string) {
    return this.svc.create(dto, uid);
  }

  @Post(':id/scan')
  @RequirePermissions(Permissions.StoresAudit)
  scan(
    @Param('id') id: string,
    @Body() body: { assetTag: string; condition?: string; notes?: string },
  ) {
    return this.svc.scan(id, body.assetTag, body.condition, body.notes);
  }

  @Post('lines/:lineId/variance')
  @RequirePermissions(Permissions.StoresAudit)
  variance(@Param('lineId') lineId: string, @Body() body: { variance: string; notes?: string }) {
    return this.svc.markVariance(lineId, body.variance, body.notes);
  }

  @Post(':id/complete')
  @RequirePermissions(Permissions.StoresAudit)
  complete(@Param('id') id: string) {
    return this.svc.complete(id);
  }
}
