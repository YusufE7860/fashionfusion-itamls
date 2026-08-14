import {
  Body, Controller, Delete, Get, Headers, Ip, Param, Post, Query, Req,
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
  listTokens(@Query('storeId') storeId?: string) {
    return this.svc.listTokens(storeId);
  }

  @Delete('enrollment-tokens/:id')
  @RequirePermissions(Permissions.AgentsManage)
  revoke(@Param('id') id: string) { return this.svc.revokeToken(id); }

  // ---- Admin: enrolled PCs ----
  @Get('pcs')
  @RequirePermissions(Permissions.AgentsRead)
  listPcs(@Query('storeId') storeId?: string) { return this.svc.listPcs(storeId); }

  @Get('pcs/:id/software')
  @RequirePermissions(Permissions.AgentsRead)
  pcSoftware(@Param('id') id: string) { return this.svc.pcSoftware(id); }

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
