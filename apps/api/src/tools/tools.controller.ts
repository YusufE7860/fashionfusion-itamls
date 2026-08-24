import { Controller, Get, NotFoundException, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Public } from '../common/decorators/permissions.decorator';

/**
 * Serves bootstrap scripts (Kaseya discovery PowerShell) over HTTP so endpoints
 * can grab them with a single Invoke-WebRequest. The script itself contains no
 * secrets — the API key and API URL are passed as parameters at runtime.
 *
 * Resolution order (highest priority first):
 *  1. /repo/tools/...          — live git-mounted volume (updated by `git pull`
 *                                without needing a docker rebuild)
 *  2. /app/tools/...           — baked into the image at build time
 *  3. <cwd>/../../tools/...    — local `pnpm dev` from apps/api
 *  4. <cwd>/tools/...          — local from the repo root
 *
 * This is important: prior to this change, only path 2 was checked, which
 * meant every edit to a .cmd or .ps1 file required a full docker rebuild.
 * Now `git pull` on the host is enough for tool file changes to go live.
 */
@Controller('tools')
export class ToolsController {
  private resolveScript() { return this.resolveToolFile('Invoke-ITAMLSDiscovery.ps1'); }

  @Public()
  @Get('discover.ps1')
  serve(@Res() res: Response) {
    const file = this.resolveScript();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="Invoke-ITAMLSDiscovery.ps1"');
    fs.createReadStream(file).pipe(res);
  }

  private resolveBackupScript() { return this.resolveToolFile('Invoke-ITAMLSBackup.ps1'); }

  @Public()
  @Get('backup.ps1')
  serveBackup(@Res() res: Response) {
    const file = this.resolveBackupScript();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="Invoke-ITAMLSBackup.ps1"');
    fs.createReadStream(file).pipe(res);
  }

  private resolveMeshScript() { return this.resolveToolFile('Install-ITAMLSMeshAgent.ps1'); }

  @Public()
  @Get('mesh-agent.ps1')
  serveMeshAgent(@Res() res: Response) {
    const file = this.resolveMeshScript();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="Install-ITAMLSMeshAgent.ps1"');
    fs.createReadStream(file).pipe(res);
  }

  // ---------- Central tool-file resolver ----------
  // /repo/tools/... comes FIRST -- that's the git-mounted volume the
  // updater and manual `git pull` write to. This means script edits go
  // live without rebuilding the API image.
  private resolveToolFile(name: string) {
    const repoDir = process.env.REPO_DIR ?? '/repo';
    const candidates = [
      path.resolve(repoDir, 'tools', name),                            // git-mounted volume (prod)
      path.resolve(process.cwd(), '..', '..', 'tools', name),          // pnpm dev from apps/api
      path.resolve(process.cwd(), 'tools', name),                      // baked into image / repo root
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    throw new NotFoundException(`${name} not found on the API server. Checked: ${candidates.join(' , ')}`);
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

  /**
   * Double-click .cmd wrapper. When called with ?token=XXX (and optionally
   * ?api=https://...) we bake those values into the file so the operator
   * just double-clicks and it runs — no manual entry. Without any query
   * params, we serve the plain template and the .cmd prompts.
   *
   * Placeholders in the source file: __EMBEDDED_API__, __EMBEDDED_TOKEN__.
   */
  @Public()
  @Get('install-itamlsagent.cmd')
  serveCmdWrapper(
    @Res() res: Response,
    @Query('token') token?: string,
    @Query('api')   api?: string,
  ) {
    const file = this.resolveToolFile('Install-ITAMLSAgent.cmd');
    let body = fs.readFileSync(file, 'utf-8');

    // Only substitute values that (a) were provided and (b) look sane.
    // Regex-anchored on the placeholder to avoid accidentally replacing
    // strings that happen to match part of the value.
    if (token && /^[A-Z0-9]{6,32}$/i.test(token)) {
      body = body.replace(/__EMBEDDED_TOKEN__/g, token.toUpperCase());
    }
    if (api && /^https?:\/\/[\w.\-]+(:\d+)?(\/[\w.\-/]*)?$/i.test(api)) {
      body = body.replace(/__EMBEDDED_API__/g, api.replace(/\/$/, ''));
    }

    // Include the token in the filename when embedded, so it's obvious
    // which .cmd goes to which store when the admin has several open.
    const suffix = token && /^[A-Z0-9]{6,32}$/i.test(token) ? `-${token.toUpperCase()}` : '';
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="Install-ITAMLSAgent${suffix}.cmd"`);
    res.send(body);
  }
}
