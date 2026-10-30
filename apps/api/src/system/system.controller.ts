import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/permissions.decorator';

/**
 * Public system info endpoint.
 *
 * Returns server-configured "public" URLs that the browser SPA uses when
 * building installer commands / download links / curl one-liners. The SPA
 * can't infer these — if an admin opens the app via the LAN IP, every URL
 * it builds from `window.location.origin` ends up pointing at the LAN IP,
 * which won't resolve from a store 500km away.
 *
 * This endpoint is intentionally Public so even the login page (which has
 * no JWT yet) can prefetch the public URL on first paint.
 */
@Controller('system')
export class SystemController {
  @Public() @Get('public-config')
  publicConfig() {
    const apiUrl = process.env.PUBLIC_API_URL ?? '';
    // Derive the web base URL from the API URL by stripping the trailing
    // /api/v1 — same host:port, no path. Fallback to the WEB_BASE_URL env.
    const webUrl =
      process.env.WEB_BASE_URL
      || apiUrl.replace(/\/api\/v\d+\/?$/, '')
      || '';
    return {
      publicApiUrl:   apiUrl,
      publicWebUrl:   webUrl,
      publicApiFqdn:  apiUrl.replace(/^https?:\/\//, '').split('/')[0],
      // Everything else the UI might want to show
      entityName: process.env.ENTITY_NAME ?? 'ITAMLS',
    };
  }
}
