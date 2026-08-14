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

  private resolveBackupScript() {
    const candidates = [
      path.resolve(process.cwd(), '..', '..', 'tools', 'Invoke-ITAMLSBackup.ps1'),
      path.resolve(process.cwd(), 'tools', 'Invoke-ITAMLSBackup.ps1'),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    throw new NotFoundException('Backup script not found on the API server.');
  }

  @Public()
  @Get('backup.ps1')
  serveBackup(@Res() res: Response) {
    const file = this.resolveBackupScript();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="Invoke-ITAMLSBackup.ps1"');
    fs.createReadStream(file).pipe(res);
  }

  private resolveMeshScript() {
    const candidates = [
      path.resolve(process.cwd(), '..', '..', 'tools', 'Install-ITAMLSMeshAgent.ps1'),
      path.resolve(process.cwd(), 'tools', 'Install-ITAMLSMeshAgent.ps1'),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    throw new NotFoundException('Mesh agent script not found on the API server.');
  }

  @Public()
  @Get('mesh-agent.ps1')
  serveMeshAgent(@Res() res: Response) {
    const file = this.resolveMeshScript();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="Install-ITAMLSMeshAgent.ps1"');
    fs.createReadStream(file).pipe(res);
  }

  // ---------- PC agent installer + companions ----------
  private resolveToolFile(name: string) {
    const candidates = [
      path.resolve(process.cwd(), '..', '..', 'tools', name),
      path.resolve(process.cwd(), 'tools', name),
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    throw new NotFoundException(`${name} not found on the API server.`);
  }

  /** Bootstrap loader — piped through `iwr ... | iex` on the PC. */
  @Public()
  @Get('install-pc.ps1')
  serveInstallPc(@Res() res: Response) {
    const file = this.resolveToolFile('install-pc.ps1');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="install-pc.ps1"');
    fs.createReadStream(file).pipe(res);
  }

  /** The real installer (defines Install-ITAMLSAgent function). */
  @Public()
  @Get('install-itamlsagent.ps1')
  serveAgentInstaller(@Res() res: Response) {
    const file = this.resolveToolFile('Install-ITAMLSAgent.ps1');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="Install-ITAMLSAgent.ps1"');
    fs.createReadStream(file).pipe(res);
  }

  /** Software inventory collector — installed by the installer, run daily. */
  @Public()
  @Get('invoke-itamlsinventory.ps1')
  serveInventoryScript(@Res() res: Response) {
    const file = this.resolveToolFile('Invoke-ITAMLSInventory.ps1');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="Invoke-ITAMLSInventory.ps1"');
    fs.createReadStream(file).pipe(res);
  }

  /** Alias so the daily-backup task's downloader hits the same casing. */
  @Public()
  @Get('invoke-itamlsbackup.ps1')
  serveBackupAlias(@Res() res: Response) {
    const file = this.resolveToolFile('Invoke-ITAMLSBackup.ps1');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="Invoke-ITAMLSBackup.ps1"');
    fs.createReadStream(file).pipe(res);
  }

  /** Double-click .cmd wrapper for non-technical store staff. */
  @Public()
  @Get('install-itamlsagent.cmd')
  serveCmdWrapper(@Res() res: Response) {
    const file = this.resolveToolFile('Install-ITAMLSAgent.cmd');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="Install-ITAMLSAgent.cmd"');
    fs.createReadStream(file).pipe(res);
  }
}
