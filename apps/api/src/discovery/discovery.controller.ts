import {
  Body, Controller, Get, Headers, Ip, Post, UnauthorizedException,
} from '@nestjs/common';
import { DiscoveryService, DiscoveryReportInput } from './discovery.service';
import { ApiKeysService } from './api-keys.service';
import { Public } from '../common/decorators/permissions.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('discovery')
export class DiscoveryController {
  constructor(private svc: DiscoveryService, private keys: ApiKeysService) {}

  @Public()
  @Post('report')
  async report(
    @Headers('x-api-key') apiKey: string,
    @Body() body: DiscoveryReportInput,
    @Ip() ip: string,
  ) {
    const key = await this.keys.validate(apiKey);
    if (!key || key.scope !== 'DISCOVERY') throw new UnauthorizedException('Invalid API key');
    return this.svc.report(body, ip);
  }

  @Get('recent')
  @RequirePermissions(Permissions.AssetsRead)
  recent() { return this.svc.recent(); }
}
