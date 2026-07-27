import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

/**
 * Returns a deep-link into the MeshCentral console filtered to an asset's
 * hostname. MeshCentral has its own auth — the technician signs in there
 * separately. Later phase: single sign-on via MeshCentral's login-token API.
 */
@Controller('remote')
export class RemoteController {
  private readonly meshBase = (process.env.MESH_BASE_URL ?? 'https://localhost:4430').replace(/\/$/, '');

  constructor(private prisma: PrismaService) {}

  @Get('asset/:id')
  @RequirePermissions(Permissions.AssetsRead)
  async byAsset(@Param('id') id: string) {
    const a = await this.prisma.asset.findUnique({
      where: { id },
      select: { id: true, assetTag: true, hostname: true, serialNo: true, sku: { select: { model: true } } },
    });
    if (!a) throw new NotFoundException();
    if (!a.hostname) {
      return {
        ready: false,
        message: 'This asset has no hostname on record. Deploy the discovery agent first so we know how to find it in MeshCentral.',
        meshBase: this.meshBase,
      };
    }
    // MeshCentral search URL — highlights matching agents in the "My Devices" list
    const url = `${this.meshBase}/?viewmode=1&search=${encodeURIComponent(a.hostname)}`;
    return { ready: true, url, meshBase: this.meshBase, hostname: a.hostname };
  }

  @Get('base-url')
  @RequirePermissions(Permissions.AssetsRead)
  baseUrl() { return { url: this.meshBase }; }
}
