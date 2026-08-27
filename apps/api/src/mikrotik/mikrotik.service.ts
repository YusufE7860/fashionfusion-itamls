import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * MikroTik store-router config generator.
 *
 * Adapted from the standalone HTML "Store Router Config Upgrader" so we can
 * generate a full RouterOS config for a NEW store from a small form, rather
 * than upgrading an existing export. Two things are intentionally left out /
 * pasted-in:
 *   - SSTP VDC tunnel   -> added by the MSP after the tunnel exists in the DC
 *   - RemoteWinbox VPN  -> operator pastes the site-specific block; we embed
 *                          it verbatim (contains site-unique user/password)
 *
 * IP allocation: one MikrotikNetworkPool row per brand tracks the last
 * third-octet handed out. Each new store gets the next /24 on that /23
 * super-prefix (10.168 for FF, 10.167 for EV, 10.166 for MB).
 */

// ---- RouterOS embedded scripts (base64, decoded at generation time) --------
// These are the exact working scripts from the current gold-standard config
// (FF_Wonderpark_Mall). Kept as base64 so escaping never drifts.
const DHCP_SCRIPT_B64 =
  'e1xyXG4gICAgaWYgKFwkYm91bmQgIT0gMSkgZG89e1xyXG4gICAgICAgIHF1aXRcclxuICAgIH1cclxuICAgIDpsb2NhbCBcInZhbHVlX3dsXCIgXCJ1bmRpc2NvdmVyZWRcIlxyXG4gICAgOmxvY2FsIFwidmFsdWVfcGZcIiBcIlwiXHJcbiAgICA6bG9jYWwgXCJ2YWx1ZV9pZlwiIFsgL2ludGVyZmFjZS9nZXQgXCRpbnRlcmZhY2UgbmFtZSBdXHJcbiAgICA6Zm9yZWFjaCBkaGMgaW49Wy9pcC9kaGNwLWNsaWVudC9maW5kIHdoZXJlIGludGVyZmFjZT1cIlwkXCJ2YWx1ZV9pZlwiXCJdIGRvPXtcclxuICAgICAgICA6bG9jYWwgZGhjYSBbL2lwL2RoY3AtY2xpZW50L2dldCBcJGRoYyBhZGRyZXNzXVxyXG4gICAgICAgIGlmIChbIDpwaWNrIFwiXCRkaGNhXCIgMCBbIDpmaW5kIFwiXCRkaGNhXCIgXCIvXCIgXSBdID0gXCJcJFwibGVhc2UtYWRkcmVzc1wiXCIpIGRvPXtcclxuICAgICAgICAgICAgOnNldCBcJFwidmFsdWVfcGZcIiBcIlwkXCJkaGNhXCJcIiBcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBpZiAoXCRcInZhbHVlX3BmXCIgfiBcIl5cXFwkXCIpIGRvPXtcclxuICAgICAgICBxdWl0XHJcbiAgICB9XHJcbiAgICA6bG9jYWwgXCJ2YWx1ZV9nd1wiIFsgL2lwL2RoY3AtY2xpZW50L2dldCBbIGZpbmQgd2hlcmUgKGRoY3Atc2VydmVyPVwiXCRcInNlcnZlci1hZGRyZXNzXCJcIiAmJiBhZGRyZXNzPVwiXCRcInZhbHVlX3BmXCJcIiAmJiBpbnRlcmZhY2U9XCJcJFwidmFsdWVfaWZcIlwiICYmIGdhdGV3YXk9XCJcJFwiZ2F0ZXdheS1hZGRyZXNzXCJcIikgXSBjb21tZW50IF1cclxuICAgIGlmIChcJFwidmFsdWVfZ3dcIiB+IFwiXldBTiBbMS0yXSBcXFxcKFNjcmlwdC1lbmFibGVkXFxcXClcXFwkXCIpIGRvPXtcclxuICAgICAgICBpZiAoXCRcInZhbHVlX2d3XCIgfiBcIl5XQU4gMVwiKSBkbz17XHJcbiAgICAgICAgICAgIDpzZXQgXCRcInZhbHVlX3dsXCIgXCJ3YW4xXCIgXHJcbiAgICAgICAgfSBlbHNlPXtcclxuICAgICAgICAgICAgOnNldCBcJFwidmFsdWVfd2xcIiBcIndhbjJcIiBcclxuICAgICAgICB9XHJcbiAgICB9IGVsc2U9e1xyXG4gICAgICAgIHF1aXRcclxuICAgIH1cclxuICAgIDpsb2NhbCBcImd3c190YWdzXCIge1xyXG4gICAgICAgIFwic3RhdGljX3dhbjFcIj1cIjsvIGNmZy0yNjA2YTAgLzsgTXVsdGlwbGUgdXBsaW5rcyAtIGZvcmNlIHZpYSBXQU4gMVwiO1xyXG4gICAgICAgIFwic3RhdGljX3dhbjJcIj1cIjsvIGNmZy0yNjA2YTAgLzsgTXVsdGlwbGUgdXBsaW5rcyAtIGZvcmNlIHZpYSBXQU4gMlwiO1xyXG4gICAgICAgIFwidGVzdC1hX3dhbjFcIj1cIjsvIGNmZy0yNjA2YTAgLzsgTXVsdGlwbGUgdXBsaW5rcyAtIHRlc3QgaG9zdCBBMSAodmlhIFdBTiAxKVwiO1xyXG4gICAgICAgIFwidGVzdC1hX3dhbjJcIj1cIjsvIGNmZy0yNjA2YTAgLzsgTXVsdGlwbGUgdXBsaW5rcyAtIHRlc3QgaG9zdCBBMiAodmlhIFdBTiAyKVwiO1xyXG4gICAgICAgIFwidGVzdC1iX3dhbjFcIj1cIjsvIGNmZy0yNjA2YTAgLzsgTXVsdGlwbGUgdXBsaW5rcyAtIHRlc3QgaG9zdCBCMSAodmlhIFdBTiAxKVwiO1xyXG4gICAgICAgIFwidGVzdC1iX3dhbjJcIj1cIjsvIGNmZy0yNjA2YTAgLzsgTXVsdGlwbGUgdXBsaW5rcyAtIHRlc3QgaG9zdCBCMiAodmlhIFdBTiAyKVwiO1xyXG4gICAgfVxyXG4gICAgOmxvY2FsIFwicm91dGUtdG90YWxcIiAwXHJcbiAgICA6Zm9yZWFjaCB0a2V5LHR2YWwgaW49W1wkXCJnd3NfdGFnc1wiXSBkbz17XHJcbiAgICAgICAgaWYgKFwkdGtleSB+IFwiXCRcInZhbHVlX3dsXCJcXFwkXCIpIGRvPXtcclxuICAgICAgICAgICAgOmxvY2FsIFwicm91dGUtdXBkYXRlXCIgWyA6bGVuIFsvaXAvcm91dGUvZmluZCB3aGVyZSAoIWJsYWNraG9sZSAmJiBjb21tZW50PVwiXCR0dmFsXCIgJiYgKGdhdGV3YXkhPVwiXCRcImdhdGV3YXktYWRkcmVzc1wiJVwkXCJ2YWx1ZV9pZlwiXCIgfHwgcHJlZi1zcmMhPVwiXCRcImxlYXNlLWFkZHJlc3NcIlwiKSldIF1cclxuICAgICAgICAgICAgaWYgKFwkXCJyb3V0ZS11cGRhdGVcIiA9IDEpIGRvPXtcclxuICAgICAgICAgICAgICAgIC9pcC9yb3V0ZS9zZXQgWyBmaW5kIHdoZXJlICghYmxhY2tob2xlICYmIGNvbW1lbnQ9XCJcJHR2YWxcIiAmJiAoZ2F0ZXdheSE9XCJcJFwiZ2F0ZXdheS1hZGRyZXNzXCIlXCRcInZhbHVlX2lmXCJcIiB8fCBwcmVmLXNyYyE9XCJcJFwibGVhc2UtYWRkcmVzc1wiXCIpKSBdIGdhdGV3YXk9XCJcJFwiZ2F0ZXdheS1hZGRyZXNzXCIlXCRcInZhbHVlX2lmXCJcIiBwcmVmLXNyYz1cIlwkXCJsZWFzZS1hZGRyZXNzXCJcIiBcclxuICAgICAgICAgICAgICAgIDpsb2NhbCBcInJvdXRlLXVwZGF0ZWRcIiBbIDpsZW4gWy9pcC9yb3V0ZS9maW5kIHdoZXJlICghYmxhY2tob2xlICYmIGNvbW1lbnQ9XCJcJHR2YWxcIiAmJiAoZ2F0ZXdheSE9XCJcJFwiZ2F0ZXdheS1hZGRyZXNzXCIlXCRcInZhbHVlX2lmXCJcIiB8fCBwcmVmLXNyYyE9XCJcJFwibGVhc2UtYWRkcmVzc1wiXCIpKV0gXVxyXG4gICAgICAgICAgICAgICAgaWYgKFwkXCJyb3V0ZS11cGRhdGVkXCIgPSAxKSBkbz17XHJcbiAgICAgICAgICAgICAgICAgICAgL2xvZy9pbmZvIG1lc3NhZ2U9XCJbbXVsdGktdXBsaW5rLXNjcmlwdF0gRmFpbGVkIHRvIHVwZGF0ZSByb3V0ZSB0YWdnZWQgYXMgXCR0a2V5XCJcclxuICAgICAgICAgICAgICAgIH0gZWxzZT17XHJcbiAgICAgICAgICAgICAgICAgICAgOnNldCBcJFwicm91dGUtdG90YWxcIiAoXCRcInJvdXRlLXRvdGFsXCIgKyAxKVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKFwkXCJyb3V0ZS10b3RhbFwiID4gMCkgZG89e1xyXG4gICAgICAgIC9sb2cvaW5mbyBtZXNzYWdlPVwiW211bHRpLXVwbGluay1zY3JpcHRdIFVwZGF0ZWQgXCRcInJvdXRlLXRvdGFsXCIgc3RhdGljIHJvdXRlcyBmb3IgXCRcInZhbHVlX3dsXCIgdG8gdXNlIERIQ1AgZ2F0ZXdheSAnXCRcImdhdGV3YXktYWRkcmVzc1wiJVwkXCJ2YWx1ZV9pZlwiJyBmcm9tICdcJFwibGVhc2UtYWRkcmVzc1wiJ1wiXHJcbiAgICB9IGVsc2U9e1xyXG4gICAgICAgIC9sb2cvaW5mbyBtZXNzYWdlPVwiW211bHRpLXVwbGluay1zY3JpcHRdIENoZWNrZWQgc3RhdGljIHJvdXRlcyBmb3IgXCRcInZhbHVlX3dsXCIsIGFsbCBPSyAoZnJvbSAnXCRcImxlYXNlLWFkZHJlc3NcIicgdmlhICdcJFwiZ2F0ZXdheS1hZGRyZXNzXCIlXCRcInZhbHVlX2lmXCInKVwiXHJcbiAgICB9XHJcbn0=';
const HEALTH_SCRIPT_B64 =
  'OmlmICggWy9pbnRlcmZhY2UgZ2V0IHZhbHVlLW5hbWU9cnVubmluZyBSZW1vdGVXaW5ib3hWUE4tWkFdICkgZG89eyAvbG9nIGRlYnVnIFwiVlBOIGlzIHVwLCBjaGVja2luZyBwaW5nIGhlYWx0aFwiOyA6aWYgKCBbL3BpbmcgYWRkcmVzcz0xNzIuMjkuMjU1LjI1NSBjb3VudD01IGludGVyZmFjZT1SZW1vdGVXaW5ib3hWUE4tWkFdID0gMCApIGRvPXsgL2xvZyBlcnJvciBcIlJXQiBWUE4gUElORyBGQUlMRUQhQXR0ZW1wdGluZyB0byByZXN0b3JlIGJ5IHRvZ2dsaW5nIFZQTiAuIERpc2FibGluZyBWUE4uLi5cIjsgL2ludGVyZmFjZSBzZXQgZGlzYWJsZWQ9eWVzIFJlbW90ZVdpbmJveFZQTi1aQTsgOmRlbGF5IDUwMDBtczsgL2xvZyBlcnJvciBcIlJlIC0gZW5hYmxpbmcgVlBOIG5vdy4uLlwiOyAvaW50ZXJmYWNlIHNldCBkaXNhYmxlZD1ubyBSZW1vdGVXaW5ib3hWUE4tWkE7IH0gZWxzZT17IC9sb2cgZGVidWcgXCJQSU5HIFBBU1NFRCFcIjsgfSB9IGVsc2U9eyAvbG9nIGluZm8gXCJWUE4gaXMgRE9XTiFBdHRlbXB0aW5nIHRvIHJlY292ZXJcIjsgL2ludGVyZmFjZSBzZXQgZGlzYWJsZWQ9eWVzIFJlbW90ZVdpbmJveFZQTi1aQTsgOmRlbGF5IDUwMDBtczsgL2xvZyBlcnJvciBcIlJlIC0gZW5hYmxpbmcgVlBOLi4uXCI7IC9pbnRlcmZhY2Ugc2V0IGRpc2FibGVkPW5vIFJlbW90ZVdpbmJveFZQTi1aQTt9';
const WGFIX_SCRIPT_B64 =
  'e1xyXG4gICAgOmxvY2FsIHdwIFsgL2ludC93aXJlZ3VhcmQvcGVlcnMvZmluZCBbIChuYW1lPWZmZy1kYy1ndyBhbmQgaW50ZXJmYWNlPXdpcmVndWFyZDEtdmRjLXR1bm5lbCkgXSBdXHJcbiAgICA6aWYgKFwkd3ApIGRvPXtcclxuICAgICAgICA6bG9jYWwgcmIgWyAvaW50L3dpcmVndWFyZC9wZWVycy9nZXQgXCR3cCByeCBdXHJcbiAgICAgICAgOmxvY2FsIGxoIFsgL2ludC93aXJlZ3VhcmQvcGVlcnMvZ2V0IFwkd3AgbGFzdC1oYW5kc2hha2UgXVxyXG4gICAgICAgIDpsb2NhbCB3aSBbIC9pbnQvd2lyZWd1YXJkIGZpbmQgWyAobmFtZT13aXJlZ3VhcmQxLXZkYy10dW5uZWwpIF0gXVxyXG4gICAgICAgIDpsb2NhbCBscCBbIC9pbnQvd2lyZWd1YXJkL2dldCBcJHdpIGxpc3Rlbi1wb3J0IF1cclxuICAgICAgICA6aWYgKChcJHJiID0gMCkgb3IgKFwkbGggPiAybSkpIGRvPXtcclxuICAgICAgICAgICAgL2ludC93aXJlZ3VhcmQvc2V0IFwkd2kgbGlzdGVuLXBvcnQ9MFxyXG4gICAgICAgICAgICA6bG9jYWwgbnAgWyAvaW50L3dpcmVndWFyZC9nZXQgXCR3aSBsaXN0ZW4tcG9ydCBdXHJcbiAgICAgICAgICAgIDpsb2NhbCBldiBcIi1cIlxyXG4gICAgICAgICAgICA6aWYgKFwkcmIgPSAwKSBkbz17XHJcbiAgICAgICAgICAgICAgICA6bG9jYWwgZXYgXCJyeC1ieXRlcyA9IDBcIlxyXG4gICAgICAgICAgICB9IGVsc2U9e1xyXG4gICAgICAgICAgICAgICAgOmxvY2FsIGV2IChcImxhc3QtaGFuZHNoYWtlID0gXCIgLiBcJGxoIC4gXCJzXCIpXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgOmxvZyBpbmZvIChcIlJlc2V0dGluZyBzcmMtcG9ydCBmb3IgaW50IHdpcmVndWFyZDEtdmRjLXR1bm5lbCAob2xkIHBvcnQ6IFwiIC4gXCRscCAuIFwiLCBsYXN0LWhhbmRzaGFrZTogXCIgLiBcJGxoIC4gXCJzLCByeC1ieXRlczogXCIgLiBcJHJiIC4gXCIsIG5ldyBwb3J0OiBcIiAuIFwkbnAgLiBcIiwgcmVhc29uOiBcIiAuIFwkZXYgLiBcIilcIiApXHJcbiAgICAgICAgfVxyXG4gICAgfSAgIFxyXG59XHJcbg==';

const b64 = (s: string) => Buffer.from(s, 'base64').toString('utf-8');

export interface GenerateDto {
  brand: string;                // FASHION_FUSION | EVOLVE | MY_BRANDS
  siteCode: string;             // "Empangeni", "WonderparkMall"
  storeId?: string;
  wan1Type?: 'DHCP' | 'PPPOE';
  wan1Iface?: string;
  wan1PppoeUser?: string;
  wan1PppoePassword?: string;
  wan2Type?: 'DHCP' | 'PPPOE';
  wan2Iface?: string;
  wan2PppoeUser?: string;
  wan2PppoePassword?: string;
  ssid: string;
  wpaPsk: string;
  wgListenPort?: number;
  wgHubPublicKey?: string;
  wgHubEndpoint?: string;
  wgHubEndpointPort?: number;
  wgTunnelIp?: string;          // 172.31.254.x/32 — from DC team; optional, can be filled in later
  remoteWinboxBlock: string;    // pasted verbatim
  dhcpRangeStart?: string;      // default "<net>.100"
  dhcpRangeEnd?: string;        // default "<net>.200"
  overrideThirdOctet?: number;  // manual override — otherwise pool auto-allocates
  createdById?: string;
}

@Injectable()
export class MikrotikService {
  constructor(private prisma: PrismaService) {}

  // ---------- Pools ----------
  listPools() {
    return this.prisma.mikrotikNetworkPool.findMany({ orderBy: { displayName: 'asc' } });
  }

  async updatePool(brand: string, patch: { lastThirdOctet?: number; ipPrefix?: string; identityPrefix?: string }) {
    const pool = await this.prisma.mikrotikNetworkPool.findUnique({ where: { brand } });
    if (!pool) throw new NotFoundException(`Unknown brand ${brand}`);
    if (patch.lastThirdOctet != null && (patch.lastThirdOctet < 0 || patch.lastThirdOctet > 254)) {
      throw new BadRequestException('lastThirdOctet must be 0..254');
    }
    return this.prisma.mikrotikNetworkPool.update({ where: { brand }, data: patch });
  }

  async previewNext(brand: string) {
    const pool = await this.prisma.mikrotikNetworkPool.findUnique({ where: { brand } });
    if (!pool) throw new NotFoundException(`Unknown brand ${brand}`);
    const nextOctet = pool.lastThirdOctet + 1;
    if (nextOctet > 254) throw new BadRequestException('Pool exhausted for this brand');
    return {
      brand: pool.brand,
      displayName: pool.displayName,
      identityPrefix: pool.identityPrefix,
      thirdOctet: nextOctet,
      lanGateway: `${pool.ipPrefix}.${nextOctet}.1`,
      lanNetwork: `${pool.ipPrefix}.${nextOctet}.0`,
      cidr: pool.cidr,
      dhcpRangeStart: `${pool.ipPrefix}.${nextOctet}.100`,
      dhcpRangeEnd:   `${pool.ipPrefix}.${nextOctet}.200`,
    };
  }

  // ---------- Configs ----------
  listConfigs() {
    return this.prisma.mikrotikConfig.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, brand: true, siteCode: true, identity: true, lanGateway: true,
                lanNetwork: true, cidr: true, thirdOctet: true, createdAt: true },
      take: 200,
    });
  }

  async getConfig(id: string) {
    const c = await this.prisma.mikrotikConfig.findUnique({ where: { id } });
    if (!c) throw new NotFoundException();
    return c;
  }

  async generate(dto: GenerateDto) {
    if (!dto.brand)          throw new BadRequestException('brand is required');
    if (!dto.siteCode?.trim()) throw new BadRequestException('siteCode is required');
    if (!dto.ssid?.trim())   throw new BadRequestException('ssid is required');
    if (!dto.wpaPsk?.trim()) throw new BadRequestException('wpaPsk is required');
    // wgTunnelIp is optional -- the DC team assigns it after the router is
    // configured. When left blank we emit a commented placeholder that the
    // technician uncomments once the assignment arrives.
    if (!dto.remoteWinboxBlock?.trim()) throw new BadRequestException('remoteWinboxBlock is required (paste from your snippets)');

    const pool = await this.prisma.mikrotikNetworkPool.findUnique({ where: { brand: dto.brand } });
    if (!pool) throw new NotFoundException(`Unknown brand ${dto.brand}`);

    // Allocate atomically — either the requested override or last+1.
    const nextOctet = dto.overrideThirdOctet ?? pool.lastThirdOctet + 1;
    if (nextOctet <= pool.lastThirdOctet && dto.overrideThirdOctet == null) {
      throw new BadRequestException('Pool went backwards — refresh and retry');
    }
    if (nextOctet < 0 || nextOctet > 254) throw new BadRequestException('third octet must be 0..254');

    const lanGateway    = `${pool.ipPrefix}.${nextOctet}.1`;
    const lanNetwork    = `${pool.ipPrefix}.${nextOctet}.0`;
    const dhcpRangeStart = dto.dhcpRangeStart || `${pool.ipPrefix}.${nextOctet}.100`;
    const dhcpRangeEnd   = dto.dhcpRangeEnd   || `${pool.ipPrefix}.${nextOctet}.200`;

    const identity = `${pool.identityPrefix}-${dto.siteCode.replace(/[^A-Za-z0-9_-]/g, '')}-GW`;

    const wan1Type  = dto.wan1Type  ?? 'DHCP';
    const wan2Type  = dto.wan2Type  ?? 'DHCP';
    const wan1Iface = dto.wan1Iface ?? 'ether1-WAN1';
    const wan2Iface = dto.wan2Iface ?? 'ether5-WAN2';

    const wgListenPort      = dto.wgListenPort      ?? 51820;
    const wgHubPublicKey    = dto.wgHubPublicKey    ?? 'N3x2X1+bvBeKsWb790Tef92R9BS/Zaa8t3OMCX8NGGc=';
    const wgHubEndpoint     = dto.wgHubEndpoint     ?? '160.119.193.152';
    const wgHubEndpointPort = dto.wgHubEndpointPort ?? 443;

    const configText = this.render({
      identity, siteCode: dto.siteCode, brand: pool.displayName,
      wan1Iface, wan1Type, wan1PppoeUser: dto.wan1PppoeUser, wan1PppoePassword: dto.wan1PppoePassword,
      wan2Iface, wan2Type, wan2PppoeUser: dto.wan2PppoeUser, wan2PppoePassword: dto.wan2PppoePassword,
      ssid: dto.ssid, wpaPsk: dto.wpaPsk,
      lanGateway, lanNetwork, cidr: 24,
      dhcpRangeStart, dhcpRangeEnd,
      wgListenPort, wgHubPublicKey, wgHubEndpoint, wgHubEndpointPort,
      wgTunnelIp: dto.wgTunnelIp?.trim() || '',
      remoteWinboxBlock: dto.remoteWinboxBlock.trim(),
    });

    // Persist + bump the pool in one transaction.
    const saved = await this.prisma.$transaction(async (tx) => {
      const rec = await tx.mikrotikConfig.create({
        data: {
          brand: pool.brand, siteCode: dto.siteCode, identity,
          storeId: dto.storeId, thirdOctet: nextOctet,
          lanGateway, lanNetwork, cidr: 24, dhcpRangeStart, dhcpRangeEnd,
          wan1Type, wan1Iface, wan1PppoeUser: dto.wan1PppoeUser, wan1PppoePassword: dto.wan1PppoePassword,
          wan2Type, wan2Iface, wan2PppoeUser: dto.wan2PppoeUser, wan2PppoePassword: dto.wan2PppoePassword,
          ssid: dto.ssid, wpaPsk: dto.wpaPsk,
          wgListenPort, wgHubPublicKey, wgHubEndpoint: wgHubEndpoint,
          wgHubEndpointPort, wgTunnelIp: dto.wgTunnelIp?.trim() || '',
          remoteWinboxBlock: dto.remoteWinboxBlock.trim(),
          configText,
          createdById: dto.createdById,
        },
      });
      // Only bump the pool forward — never backwards on manual override.
      if (nextOctet > pool.lastThirdOctet) {
        await tx.mikrotikNetworkPool.update({
          where: { brand: pool.brand }, data: { lastThirdOctet: nextOctet },
        });
      }
      return rec;
    });

    return saved;
  }

  // ---------- Helpers ----------
  /**
   * Emit /interface ethernet `set` lines to rename the factory ether ports to
   * whatever the operator picked in the form (default: ether1-WAN1 + ether5-WAN2).
   * We derive the ORIGINAL port name from the desired name by stripping the
   * `-WAN{n}` suffix — so `ether1-WAN1` -> match default-name `ether1`.
   * If the desired name doesn't start with `ether`, we skip that rename (e.g.
   * PPPoE fiber uplinks may use pseudo-names like `pppoe-out1`).
   */
  private renameEthernetPorts(wan1: string, wan2: string): string[] {
    const lines: string[] = [];
    for (const wanName of [wan1, wan2]) {
      const m = wanName.match(/^(ether\d+)-WAN\d+$/i);
      if (!m) continue;
      const original = m[1];
      lines.push(`# find default-name=${original} -> ${wanName} (safe no-op if already renamed)`);
      lines.push(`:local iface [/interface ethernet find where default-name=${original}]`);
      lines.push(`:if ([:len $iface] > 0) do={ /interface ethernet set $iface name=${wanName} }`);
    }
    if (lines.length === 0) {
      lines.push('# (no ethernet renames needed for the selected WAN interfaces)');
    }
    return lines;
  }

  // ---------- Renderer ----------
  private render(f: {
    identity: string; siteCode: string; brand: string;
    wan1Iface: string; wan1Type: 'DHCP' | 'PPPOE'; wan1PppoeUser?: string; wan1PppoePassword?: string;
    wan2Iface: string; wan2Type: 'DHCP' | 'PPPOE'; wan2PppoeUser?: string; wan2PppoePassword?: string;
    ssid: string; wpaPsk: string;
    lanGateway: string; lanNetwork: string; cidr: number;
    dhcpRangeStart: string; dhcpRangeEnd: string;
    wgListenPort: number; wgHubPublicKey: string; wgHubEndpoint: string; wgHubEndpointPort: number;
    wgTunnelIp: string; remoteWinboxBlock: string;
  }): string {
    const date = new Date().toISOString().slice(0, 10);
    const wgTunnelName = 'wireguard1-vdc-tunnel';

    const wanClient = (n: 1 | 2, iface: string, type: 'DHCP' | 'PPPOE', user?: string, pw?: string) => {
      if (type === 'PPPOE') {
        return `remove [find where interface=${iface}]\nadd add-default-route=no disabled=no interface=${iface} name=pppoe-out${n} use-peer-dns=yes user=${user ?? ''}${pw ? ' password=' + pw : ''}`;
      }
      return `remove [find where interface=${iface}]\nadd comment="WAN ${n} (Script-enabled)" default-route-distance=1${n === 1 ? '1' : '2'} interface=${iface} \\\n    script="${b64(DHCP_SCRIPT_B64)}"`;
    };

    const legRoutes = (n: 1 | 2, iface: string, type: 'DHCP' | 'PPPOE', prefSrc: string) => {
      const testA = n === 1 ? '9.9.9.10' : '9.9.9.11';
      const testB = n === 1 ? '149.112.112.10' : '149.112.112.11';
      const gw = type === 'PPPOE' ? `pppoe-out${n}` : `10.0.0.254%${iface}`;
      const src = type === 'PPPOE' ? '' : ` pref-src=${prefSrc}`;
      return [
        `add blackhole comment=";/ cfg-2606a0 /; Multiple uplinks - force via WAN ${n}" disabled=no distance=254 \\`,
        `    dst-address=0.0.0.0/0 routing-table=alt-wan${n}`,
        `add comment=";/ cfg-2606a0 /; Multiple uplinks - force via WAN ${n}" disabled=no distance=1 dst-address=0.0.0.0/0 \\`,
        `    gateway=${gw}${src} routing-table=alt-wan${n}`,
        `add check-gateway=ping comment=";/ cfg-2606a0 /; Multiple uplinks - test host A${n} (via WAN ${n})" disabled=no \\`,
        `    dst-address=${testA}/32 gateway=${gw}${src} scope=11`,
        `add check-gateway=ping comment=";/ cfg-2606a0 /; Multiple uplinks - test host B${n} (via WAN ${n})" disabled=no \\`,
        `    dst-address=${testB}/32 gateway=${gw}${src} scope=11`,
      ].join('\n');
    };

    const dhcpClientLines = [
      f.wan1Type === 'DHCP' ? wanClient(1, f.wan1Iface, 'DHCP') : null,
      f.wan2Type === 'DHCP' ? wanClient(2, f.wan2Iface, 'DHCP') : null,
    ].filter(Boolean).join('\n');
    const pppoeClientLines = [
      f.wan1Type === 'PPPOE' ? wanClient(1, f.wan1Iface, 'PPPOE', f.wan1PppoeUser, f.wan1PppoePassword) : null,
      f.wan2Type === 'PPPOE' ? wanClient(2, f.wan2Iface, 'PPPOE', f.wan2PppoeUser, f.wan2PppoePassword) : null,
    ].filter(Boolean).join('\n');

    const wanRoutesBlock = [
      legRoutes(1, f.wan1Iface, f.wan1Type, `${f.lanGateway.replace(/\.\d+$/, '.135')}`),
      legRoutes(2, f.wan2Iface, f.wan2Type, `${f.lanGateway.replace(/\.\d+$/, '.100')}`),
    ].join('\n');

    // Ensure wgTunnelIp has a mask; typical DC allocation is /32 on 172.31.254.x.
    // Empty string = the operator will fill it in later after the DC team
    // assigns one -- we emit a commented placeholder in the config.
    const wgIpProvided = !!f.wgTunnelIp?.trim();
    const wgAddr = wgIpProvided
      ? (/\//.test(f.wgTunnelIp) ? f.wgTunnelIp : `${f.wgTunnelIp}/32`)
      : '<172.31.254.X>/32';

    return `# Generated ${date} by ITAMLS MikroTik config generator
# NEW STORE build for site: ${f.identity}  (brand: ${f.brand})
# Built on the FF_Wonderpark_Mall gold-standard template.
#
# MANUAL STEPS AFTER APPLYING:
#   1. MSP must add the SSTP VDC tunnel (sstp1-vdc-tunnel) with the
#      site-specific user, password and DC certificate.
#   2. Verify the WireGuard peer public-key printed on this router matches
#      what the DC hub has registered against ${wgAddr}.
#   3. Confirm both WAN uplinks come up green.${wgIpProvided ? '' : `
#   4. **WireGuard tunnel IP NOT SET** — the /ip address line for
#      wireguard1-vdc-tunnel is commented out below. Once the DC team
#      assigns a /32 (typical: 172.31.254.X), uncomment that line and set
#      the correct address, then apply just that fragment via /import.`}
#
# The RemoteWinbox VPN block (SSTP client + profile) below was pasted in
# from the operator's per-site snippet.

# ---- Rename ethernet ports so subsequent references resolve ----
# On a factory-fresh RouterOS device the ports are ether1..etherN. All later
# steps refer to ${f.wan1Iface} / ${f.wan2Iface} etc, so we must rename first.
# Matching on default-name means this is a safe no-op on routers that have
# already been through this template (the second run finds nothing to rename).
/interface ethernet
${this.renameEthernetPorts(f.wan1Iface, f.wan2Iface).join('\n')}

/interface bridge
remove [find where name=bridge-lan]
add name=bridge-lan

# Wireless: only apply if this router has a built-in wireless module.
# Wireless-less routers (RB4011, hEX etc) have no wlan1 so we skip cleanly
# instead of failing the import.
:local wlan [/interface wireless find where default-name=wlan1]
:if ([:len $wlan] > 0) do={ /interface wireless set $wlan disabled=no mode=ap-bridge ssid="${f.ssid}" }

/interface wireguard
remove [find where name=${wgTunnelName}]
add comment=";/ cfg-2506a0 /; VDC backup tunnel for site '${f.siteCode}'" \\
    listen-port=${f.wgListenPort} mtu=1420 name=${wgTunnelName}

/interface list
remove [find where name=WAN]
add name=WAN
remove [find where name=LAN]
add name=LAN
remove [find where name=zone-WAN]
add comment=";/ cfg-2506a0 /;" include=WAN name=zone-WAN
remove [find where name=ints-MAC-WinBox]
add comment=";/ cfg-2506a0 /;" exclude=zone-WAN include=all name=ints-MAC-WinBox
remove [find where name=zone-VDC]
add comment=";/ cfg-2506a0 /;" name=zone-VDC
remove [find where name=ints-MAC-Telnet]
add comment=";/ cfg-2506a0 /;" exclude=zone-WAN name=ints-MAC-Telnet
remove [find where name=zone-LAN]
add comment=";/ cfg-2506a0 /;" exclude=zone-VDC,zone-WAN name=zone-LAN
remove [find where name=ints-LLDP]
add comment=";/ cfg-2506a0 /;" include=zone-LAN name=ints-LLDP

# Wireless security profile — same conditional guard as above.
:local wsp [/interface wireless security-profiles find where default=yes]
:if ([:len $wsp] > 0) do={ /interface wireless security-profiles set $wsp authentication-types=wpa-psk,wpa2-psk mode=dynamic-keys supplicant-identity=MikroTik wpa-pre-shared-key=${f.wpaPsk} wpa2-pre-shared-key=${f.wpaPsk} }

/ip ipsec proposal
set [ find default=yes ] disabled=yes

/ip pool
remove [find where name=dhcp_pool]
add name=dhcp_pool ranges=${f.dhcpRangeStart}-${f.dhcpRangeEnd}

/ip dhcp-server
remove [find where name=dhcp-lan]
add address-pool=dhcp_pool interface=bridge-lan name=dhcp-lan

/ppp profile
remove [find where name=sstp-int-defaults]
add change-tcp-mss=yes comment=";/ cfg-2506a0 /;" name=sstp-int-defaults only-one=yes \\
    use-encryption=required use-ipv6=no use-mpls=no use-upnp=no

# ---- RemoteWinbox VPN (pasted verbatim per-site) ----
${f.remoteWinboxBlock}
# ---- end RemoteWinbox block ----

# NOTE: /interface sstp-client for the VDC tunnel (sstp1-vdc-tunnel) is
# INTENTIONALLY NOT emitted here -- your MSP adds it after the tunnel
# exists in the DC and its site certificate has been imported.

/routing table
remove [find where name=opt-wan1]
add comment=";/ cfg-2606a0 /; Multiple uplinks - prefer WAN 1" fib name=opt-wan1
remove [find where name=opt-wan2]
add comment=";/ cfg-2606a0 /; Multiple uplinks - prefer WAN 2" fib name=opt-wan2
remove [find where name=alt-wan1]
add comment=";/ cfg-2606a0 /; Multiple uplinks - force via WAN 1" fib name=alt-wan1
remove [find where name=alt-wan2]
add comment=";/ cfg-2606a0 /; Multiple uplinks - force via WAN 2" fib name=alt-wan2

/interface bridge port
remove [find where interface=ether2]
add bridge=bridge-lan interface=ether2
remove [find where interface=ether3]
add bridge=bridge-lan interface=ether3
remove [find where interface=ether5]
add bridge=bridge-lan interface=ether5
# wlan1 bridge port — only if the router has a wireless module
:if ([:len [/interface find where name=wlan1]] > 0) do={ /interface bridge port remove [find where interface=wlan1]; /interface bridge port add bridge=bridge-lan interface=wlan1 }

/ip firewall connection tracking
set udp-timeout=10s

/ip neighbor discovery-settings
set discover-interface-list=ints-LLDP discover-interval=1m protocol=lldp

/ip settings
set max-neighbor-entries=8192

/ipv6 settings
set disable-ipv6=yes

/interface list member
remove [find where interface=${f.wan1Iface} and list=WAN]
add interface=${f.wan1Iface} list=WAN
remove [find where interface=bridge-lan and list=LAN]
add interface=bridge-lan list=LAN
remove [find where interface=${wgTunnelName} and list=zone-VDC]
add comment=";/ cfg-2506a0 /;" interface=${wgTunnelName} list=zone-VDC
remove [find where interface=${f.wan2Iface} and list=WAN]
add interface=${f.wan2Iface} list=WAN

/interface wireguard peers
remove [find where name=ffg-dc-gw]
add allowed-address=0.0.0.0/0 comment=";/ cfg-2506a0 /; VDC backup tunnel for site '${f.siteCode}';;" \\
    endpoint-address=${f.wgHubEndpoint} endpoint-port=${f.wgHubEndpointPort} interface=${wgTunnelName} \\
    name=ffg-dc-gw persistent-keepalive=5s public-key="${f.wgHubPublicKey}"

/ip address
remove [find where interface=bridge-lan]
add address=${f.lanGateway}/${f.cidr} interface=bridge-lan network=${f.lanNetwork}
remove [find where interface=${wgTunnelName}]
${wgIpProvided
  ? `add address=${wgAddr} comment=";/ cfg-2506a0 /;" interface=${wgTunnelName} network=172.31.254.0`
  : `# WireGuard tunnel IP not yet assigned. When the DC team gives you the /32,
# replace <172.31.254.X> below and uncomment this line:
# add address=${wgAddr} comment=";/ cfg-2506a0 /;" interface=${wgTunnelName} network=172.31.254.0`}
${pppoeClientLines ? '\n/interface pppoe-client\n' + pppoeClientLines : ''}
${dhcpClientLines  ? '\n/ip dhcp-client\n'         + dhcpClientLines  : ''}

/ip dhcp-server network
remove [find where address=${f.lanNetwork}/${f.cidr}]
add address=${f.lanNetwork}/${f.cidr} dns-server=1.1.1.1,8.8.8.8 gateway=${f.lanGateway}

/ip dns
set allow-remote-requests=yes servers=9.9.9.9,1.1.1.1

/ip firewall address-list
add address=${f.lanNetwork}/${f.cidr} comment=";/ cfg-2506a0 /;" list=store-lan-subnets
add address=10.64.9.0/24 comment=";/ cfg-2506a0 /;" list=vdc-tunnel-subnets
add address=66.8.25.75 comment=";/ cfg-2506a0 /;" list=vdc-tunnel-subnets
add address=66.8.25.87 comment=";/ cfg-2506a0 /;" list=vdc-tunnel-subnets
add address=66.8.58.195 comment=";/ cfg-2506a0 /;" list=vdc-tunnel-subnets
add address=172.31.253.0 comment=";/ cfg-2506a0 /;" list=vdc-tunnel-subnets
add address=172.31.254.0 comment=";/ cfg-2506a0 /;" list=vdc-tunnel-subnets
add address=${f.wgHubEndpoint} comment=";/ cfg-2506a0 /;" list=vdc-tunnel-endpoints

/ip firewall filter
add action=accept chain=output comment=";/ cfg-2606a0 /; VDC tunnel sessions - outbound towards WAN" \\
    dst-address-list=vdc-tunnel-endpoints src-address-type=local
add action=accept chain=input comment=";/ cfg-2506a0 /; Allow Remote Winbox" in-interface=RemoteWinboxVPN-ZA
add action=accept chain=forward comment=";/ cfg-2506a0 /;" connection-state=untracked
add action=accept chain=input comment="Allow established/related" connection-state=established,related
add action=drop   chain=input comment="Drop invalid" connection-state=invalid
add action=accept chain=input comment="Allow ICMP" protocol=icmp
add action=accept chain=input comment="Allow LAN access" src-address=${f.lanNetwork}/${f.cidr}
add action=drop   chain=input comment="Default drop"

/ip firewall mangle
add action=mark-routing chain=output comment=";/ cfg-2606a0 /; VDC tunnel sessions - WireGuard outbound towards WAN" \\
    dst-address-list=vdc-tunnel-endpoints dst-port=443 new-routing-mark=opt-wan1 protocol=udp src-address-type=local
add action=mark-routing chain=output comment=";/ cfg-2606a0 /; VDC tunnel sessions - SSTP outbound towards WAN" \\
    dst-address-list=vdc-tunnel-endpoints dst-port=443 new-routing-mark=opt-wan2 protocol=tcp src-address-type=local
add action=accept chain=prerouting  comment=";/ cfg-2506a0 /;" connection-state=untracked
add action=accept chain=forward     comment=";/ cfg-2506a0 /;" connection-state=untracked
add action=accept chain=postrouting comment=";/ cfg-2506a0 /;" connection-state=untracked

/ip firewall nat
add action=masquerade chain=srcnat comment=";/ cfg-2606a0 /; Local outbound - masquerade" \\
    out-interface-list=WAN src-address-type=local

/ip firewall raw
add action=accept  chain=output     comment=";/ cfg-2606a0 /; VDC tunnel sessions - outbound towards WAN" \\
    dst-address-list=vdc-tunnel-endpoints src-address-type=local
add action=notrack chain=prerouting comment=";/ cfg-2506a0 /; VDC tunneled traffic - Outbound from store" \\
    dst-address-list=vdc-tunnel-subnets in-interface-list=zone-LAN src-address-list=store-lan-subnets
add action=notrack chain=output     comment=";/ cfg-2506a0 /; VDC tunneled traffic - Outbound from router" \\
    out-interface-list=zone-VDC src-address-type=local
add action=notrack chain=prerouting comment=";/ cfg-2506a0 /; VDC tunneled traffic - Inbound from DC" \\
    in-interface-list=zone-VDC

/ip ipsec policy
set 0 disabled=yes

/ip proxy
set max-cache-object-size=64KiB max-cache-size=none

/ip route
# Once the MSP adds sstp1-vdc-tunnel, uncomment these primary paths.
# add comment=";/ cfg-2506a0 /;" dst-address=10.64.9.0/24  gateway=sstp1-vdc-tunnel
# add comment=";/ cfg-2506a0 /;" dst-address=66.8.25.75/32 gateway=sstp1-vdc-tunnel pref-src=${f.lanGateway}
# add comment=";/ cfg-2506a0 /;" dst-address=66.8.25.87/32 gateway=sstp1-vdc-tunnel pref-src=${f.lanGateway}
# add comment=";/ cfg-2506a0 /;" dst-address=66.8.58.195/32 gateway=sstp1-vdc-tunnel pref-src=${f.lanGateway}
add comment=";/ cfg-2506a0 /;" distance=2 dst-address=10.64.9.0/24  gateway=${wgTunnelName}
add comment=";/ cfg-2506a0 /;" distance=2 dst-address=66.8.25.75/32 gateway=${wgTunnelName} pref-src=${f.lanGateway}
add comment=";/ cfg-2506a0 /;" distance=2 dst-address=66.8.25.87/32 gateway=${wgTunnelName} pref-src=${f.lanGateway}
add comment=";/ cfg-2506a0 /;" distance=2 dst-address=66.8.58.195/32 gateway=${wgTunnelName} pref-src=${f.lanGateway}
add blackhole comment=";/ cfg-2506a0 /;" distance=2 dst-address=10.64.9.0/24
add blackhole comment=";/ cfg-2506a0 /;" distance=2 dst-address=66.8.58.195
add blackhole comment=";/ cfg-2506a0 /;" distance=2 dst-address=66.8.25.87
add blackhole comment=";/ cfg-2506a0 /;" distance=2 dst-address=66.8.25.75
${wanRoutesBlock}

/ip service
set ftp disabled=yes
set telnet disabled=yes
set www disabled=yes
set winbox address=${f.lanNetwork}/${f.cidr},172.31.255.0/24,172.31.254.0/24,172.31.253.0/24
set api disabled=yes
set api-ssl disabled=yes

/system clock
set time-zone-name=Africa/Johannesburg

/system identity
set name=${f.identity}

/system note
set note="Auto cfg v2606a0 - generated by ITAMLS" show-at-login=no

/system package update
set channel=long-term

/system scheduler
remove [find where name=RWBHEALTHCHECK]
add interval=5m name=RWBHEALTHCHECK on-event=RWBHEALTHCHECK policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon \\
    start-time=startup
remove [find where name=fix-${wgTunnelName}]
add comment=";/ cfg-2506a1 /;" interval=1m name=fix-${wgTunnelName} on-event="${b64(WGFIX_SCRIPT_B64)}" \\
    policy=read,write start-time=startup

/system script
remove [find where name=RWBHEALTHCHECK]
add dont-require-permissions=no name=RWBHEALTHCHECK policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon \\
    source="${b64(HEALTH_SCRIPT_B64)}"

/tool bandwidth-server
set enabled=no

/tool mac-server
set allowed-interface-list=ints-MAC-Telnet

/tool mac-server mac-winbox
set allowed-interface-list=ints-MAC-WinBox
`;
  }
}
