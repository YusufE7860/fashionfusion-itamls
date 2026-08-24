import {
  Body, Controller, Delete, Get, Headers, Ip, Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { AgentsService, EnrollDto, InventoryDto, IssueTokenDto } from './agents.service';
import { RequirePermissions, Public } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('agents')
export class AgentsController {
  constructor(private svc: AgentsService) {}

  // ---- Admin: enrollment tokens ----
  @Post('enrollment-tokens')
  @RequirePermissions(Permissions.AgentsManage)
  issue(@Body() dto: IssueTokenDto, @Req() req: any) {
    return this.svc.issueToken(dto, req.user?.sub);
  }

  @Get('enrollment-tokens')
  @RequirePermissions(Permissions.AgentsRead)
  listTokens(@Query() q: { storeId?: string; departmentId?: string; scope?: string }) {
    return this.svc.listTokens(q);
  }

  @Delete('enrollment-tokens/:id')
  @RequirePermissions(Permissions.AgentsManage)
  revoke(@Param('id') id: string) { return this.svc.revokeToken(id); }

  // ---- Admin: enrolled PCs ----
  @Get('pcs')
  @RequirePermissions(Permissions.AgentsRead)
  listPcs(@Query() q: { storeId?: string; departmentId?: string; scope?: string }) {
    return this.svc.listPcs(q);
  }

  @Get('pcs/:id/software')
  @RequirePermissions(Permissions.AgentsRead)
  pcSoftware(@Param('id') id: string) { return this.svc.pcSoftware(id); }

  @Get('pcs/:id')
  @RequirePermissions(Permissions.AgentsRead)
  getPc(@Param('id') id: string) { return this.svc.getPc(id); }

  @Patch('pcs/:id/backup-paths')
  @RequirePermissions(Permissions.AgentsManage)
  updatePcBackupPaths(@Param('id') id: string, @Body() dto: { paths: string[] }) {
    return this.svc.updatePcBackupPaths(id, dto.paths ?? []);
  }

  @Patch('pcs/:id/active')
  @RequirePermissions(Permissions.AgentsManage)
  setPcActive(@Param('id') id: string, @Body() dto: { isActive: boolean }) {
    return this.svc.setPcActive(id, !!dto.isActive);
  }

  // ---- Public: called by the installer/agent ----
  @Public()
  @Post('enroll')
  enroll(@Body() dto: EnrollDto, @Ip() ip: string) { return this.svc.enroll(dto, ip); }

  @Public()
  @Post('inventory')
  inventory(
    @Headers('x-api-key') key: string,
    @Body() dto: InventoryDto,
    @Ip() ip: string,
  ) { return this.svc.ingestInventory(key, dto, ip); }
}
