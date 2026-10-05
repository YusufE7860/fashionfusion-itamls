import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Auto-routing: given a store + category, pick the best technician.
 *
 * Chain:
 *   store → area managers with UserStoreAccess for that store
 *         → each AM's managedByTechId (the technician who handles them)
 *   Of all candidate techs, pick the one with the FEWEST open tickets
 *   (crude round-robin that balances load without extra config).
 *
 * Fallback (in order):
 *   1. Category's defaultAssigneeId (static per-category routing)
 *   2. Null — ticket stays NEW/unassigned, lands in the general queue
 */
@Injectable()
export class HelpdeskRoutingService {
  constructor(private prisma: PrismaService) {}

  async pickAutoAssignee(opts: { storeId?: string | null; categoryId: string }): Promise<string | null> {
    const { storeId, categoryId } = opts;

    // 1. Try the AM chain (store-scoped)
    if (storeId) {
      const amLinks = await this.prisma.userStoreAccess.findMany({
        where: {
          storeId,
          user: { role: { code: 'AREA_MANAGER' }, isActive: true },
        },
        select: { user: { select: { id: true, managedByTechId: true } } },
      });

      // Dedupe candidate technicians (an AM might manage multiple stores — only
      // their tech matters, picked once)
      const techIds = [...new Set(
        amLinks.map((a) => a.user.managedByTechId).filter((v): v is string => !!v),
      )];

      if (techIds.length) {
        // Load open-ticket count per candidate; pick the lowest
        const loads = await Promise.all(
          techIds.map(async (id) => ({
            id,
            open: await this.prisma.ticket.count({
              where: { assignedToId: id, status: { notIn: ['RESOLVED', 'CLOSED'] } },
            }),
          })),
        );
        loads.sort((a, b) => a.open - b.open);
        return loads[0].id;
      }
    }

    // 2. Fallback: category default assignee
    const cat = await this.prisma.ticketCategory.findUnique({
      where: { id: categoryId }, select: { defaultAssigneeId: true },
    });
    return cat?.defaultAssigneeId ?? null;
  }

  /** Reporting: which area manager(s) oversee this store. */
  async areaManagersForStore(storeId: string) {
    const rows = await this.prisma.userStoreAccess.findMany({
      where: { storeId, user: { role: { code: 'AREA_MANAGER' } } },
      include: { user: { include: { role: true, managedByTech: { select: { id: true, fullName: true } } } } },
    });
    return rows.map((r) => r.user);
  }
}
