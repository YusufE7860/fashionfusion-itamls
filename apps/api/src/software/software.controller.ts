import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AssignDto, CreateLicenseDto, CreateTitleDto, SoftwareService } from './software.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('software')
export class SoftwareController {
  constructor(private svc: SoftwareService) {}

  @Get('summary')   @RequirePermissions(Permissions.CatalogRead)
  summary() { return this.svc.summary(); }

  @Get('titles')    @RequirePermissions(Permissions.CatalogRead)
  titles() { return this.svc.titles(); }

  @Post('titles')   @RequirePermissions(Permissions.CatalogWrite)
  createTitle(@Body() dto: CreateTitleDto) { return this.svc.createTitle(dto); }

  @Get('licenses/:id') @RequirePermissions(Permissions.CatalogRead)
  license(@Param('id') id: string) { return this.svc.license(id); }

  @Post('licenses') @RequirePermissions(Permissions.CatalogWrite)
  createLicense(@Body() dto: CreateLicenseDto) { return this.svc.createLicense(dto); }

  @Post('licenses/:id/assign') @RequirePermissions(Permissions.CatalogWrite)
  assign(@Param('id') id: string, @Body() dto: AssignDto) { return this.svc.assign(id, dto); }

  @Post('assignments/:id/revoke') @RequirePermissions(Permissions.CatalogWrite)
  revoke(@Param('id') id: string) { return this.svc.revoke(id); }
}
