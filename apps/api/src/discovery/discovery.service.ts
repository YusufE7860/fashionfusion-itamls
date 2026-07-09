import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DiscoveryReportInput {
  hostname: string;
  manufacturer?: string;
  model?: string;
  serialNo?: string;
  osVersion?: string;
  cpuModel?: string;
  ramGb?: number;
  macAddresses?: string[];
  /** Optional location hint from the agent (e.g. store code). */
  locationCode?: string;
  raw?: any;
}

@Injectable()
export class DiscoveryService {
  constructor(private prisma: PrismaService) {}

  async report(input: DiscoveryReportInput, sourceIp?: string) {
    // PowerShell serializes a single-element array as a bare string — normalize here.
    const macList = Array.isArray(input.macAddresses)
      ? input.macAddresses
      : input.macAddresses
        ? [input.macAddresses as unknown as string]
        : [];
    const macs = macList.join(',') || undefined;

    // Match an existing asset by serial number first, then by hostname
    let asset = input.serialNo
      ? await this.prisma.asset.findFirst({ where: { serialNo: input.serialNo } })
      : null;
    if (!asset && input.hostname) {
      asset = await this.prisma.asset.findFirst({ where: { hostname: input.hostname } });
    }

    // Resolve optional location hint
    let locationId: string | undefined = undefined;
    if (input.locationCode) {
      const loc = await this.prisma.location.findUnique({ where: { code: input.locationCode } });
      locationId = loc?.id;
    }

    if (asset) {
      // Update existing asset metadata + last-seen
      asset = await this.prisma.asset.update({
        where: { id: asset.id },
        data: {
          hostname: input.hostname,
          osVersion: input.osVersion,
          cpuModel: input.cpuModel,
          ramGb: input.ramGb,
          macAddresses: macs,
          lastSeenAt: new Date(),
          locationId: locationId ?? asset.locationId,
          source: asset.source ?? 'DISCOVERY',
        },
      });
    } else {
      // Create a "Desktop PCs" SKU if missing — fallback so we can persist anything
      let sku = await this.prisma.sku.findFirst({
        where: { manufacturer: input.manufacturer ?? 'Unknown', model: input.model ?? 'Unknown' },
      });
      if (!sku) {
        const category = await this.prisma.category.findFirst({ where: { name: 'Desktop PCs' } });
        if (!category) throw new Error('No "Desktop PCs" category seeded');
        sku = await this.prisma.sku.create({
          data: {
            code: `DISC-${(input.manufacturer ?? 'UNK').replace(/\s+/g,'')}-${(input.model ?? 'UNK').replace(/\s+/g,'')}`.slice(0, 60),
            name: `${input.manufacturer ?? 'Unknown'} ${input.model ?? 'Unknown'} (discovered)`,
            categoryId: category.id,
            manufacturer: input.manufacturer ?? 'Unknown',
            model: input.model ?? 'Unknown',
            isSerialised: true,
          },
        });
      }

      const tagCount = await this.prisma.asset.count();
      const tag = `FF-D-${String(tagCount + 1).padStart(6, '0')}`;
      // Default the asset's value to the SKU's catalogue cost. Zero until the
      // admin sets a cost on the SKU — then they can cascade to existing assets.
      const seedCost = sku.unitCostCents ?? 0;
      asset = await this.prisma.asset.create({
        data: {
          assetTag: tag,
          serialNo: input.serialNo,
          skuId: sku.id,
          hostname: input.hostname,
          osVersion: input.osVersion,
          cpuModel: input.cpuModel,
          ramGb: input.ramGb,
          macAddresses: macs,
          lastSeenAt: new Date(),
          locationId,
          source: 'DISCOVERY',
          status: locationId ? 'IN_STORE' : 'IN_STOCK',
          purchaseDate: new Date(),
          purchaseCostCents: seedCost,
          currentValueCents: seedCost,
        },
      });
      await this.prisma.assetHistory.create({
        data: {
          assetId: asset.id,
          eventType: 'PURCHASED',
          toLocationId: locationId,
          notes: 'Auto-created from discovery agent',
        },
      });
    }

    await this.prisma.discoveryReport.create({
      data: {
        assetId: asset.id,
        hostname: input.hostname,
        manufacturer: input.manufacturer,
        model: input.model,
        serialNo: input.serialNo,
        osVersion: input.osVersion,
        cpuModel: input.cpuModel,
        ramGb: input.ramGb,
        macAddresses: macs,
        payload: input.raw ? JSON.stringify(input.raw) : undefined,
        sourceIp,
      },
    });

    return { assetId: asset.id, assetTag: asset.assetTag };
  }

  recent(limit = 100) {
    return this.prisma.discoveryReport.findMany({
      orderBy: { reportedAt: 'desc' },
      take: limit,
    });
  }
}
