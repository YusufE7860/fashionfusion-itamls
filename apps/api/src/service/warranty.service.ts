import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WarrantyService {
  constructor(private prisma: PrismaService) {}

  /** Assets whose warranty expires in <= `days` and is not yet expired. */
  async expiring(days: number) {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + days);
    return this.prisma.asset.findMany({
      where: {
        warrantyExpiry: { lte: cutoff, gte: now },
        status: { notIn: ['DISPOSED', 'WRITTEN_OFF', 'LOST'] },
      },
      include: { sku: true, supplier: true, location: true, assignedStore: true },
      orderBy: { warrantyExpiry: 'asc' },
    });
  }

  /** Aggregate counts for the dashboard tiles. */
  async dashboard() {
    const [in30, in60, in90, expired] = await Promise.all([
      this.expiring(30),
      this.expiring(60),
      this.expiring(90),
      this.prisma.asset.count({
        where: {
          warrantyExpiry: { lt: new Date() },
          status: { notIn: ['DISPOSED', 'WRITTEN_OFF', 'LOST'] },
        },
      }),
    ]);
    return {
      expiring30: in30.length,
      expiring60: in60.length,
      expiring90: in90.length,
      alreadyExpired: expired,
    };
  }
}
