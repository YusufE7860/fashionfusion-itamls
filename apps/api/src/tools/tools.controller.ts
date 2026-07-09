import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Public } from '../common/decorators/permissions.decorator';

/**
 * Serves bootstrap scripts (Kaseya discovery PowerShell) over HTTP so endpoints
 * can grab them with a single Invoke-WebRequest. The script itself contains no
 * secrets — the API key and API URL are passed as parameters at runtime.
 */
@Controller('tools')
export class ToolsController {
  // Resolve from the monorepo root: <repo>/tools/Invoke-ITAMLSDiscovery.ps1
  // process.cwd() during `pnpm api:dev` is apps/api/
  private resolveScript() {
    const candidates = [
      path.resolve(process.cwd(), '..', '..', 'tools', 'Invoke-ITAMLSDiscovery.ps1'),
      path.resolve(process.cwd(), 'tools', 'Invoke-ITAMLSDiscovery.ps1'),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    throw new NotFoundException('Discovery script not found on the API server.');
  }

  @Public()
  @Get('discover.ps1')
  serve(@Res() res: Response) {
    const file = this.resolveScript();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="Invoke-ITAMLSDiscovery.ps1"');
    fs.createReadStream(file).pipe(res);
  }
}
