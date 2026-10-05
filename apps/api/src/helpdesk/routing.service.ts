import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Auto-routing: given a store + category, pick the best technician AND the
 * AreaManager snapshot to attach to the ticket.
 *
 * New primary chain (AreaManager entity):
 *   store.areaManagerId → AreaManager.assignedTechId → tech
 *
 * Legacy chain (for stores still linked via UserStoreAccess):
 *   store → User (role AREA_MANAGER) → User.managedByTechId → tech
 *
 * Fallback: category.defaultAssigneeId → null (land in general queue).
 */
@Injectable()
export class HelpdeskRoutingService {
  constructor(private prisma: PrismaService) {}

  async pickRoute(opts: { storeId?: string | null; categoryId: string }): Promise<{
    assigneeId: string | null;
    areaManagerId: string | null;
  }> {
    const { storeId, categoryId } = opts;

    if (storeId) {
      // 1. NEW: AreaManager entity attached to store
      const store = await this.prisma.store.findUnique({
        where: { id: storeId },
        include: { areaManager: { include: { assignedTech: true } } },
      });
      if (store?.areaManager?.isActive && store.areaManager.assignedTechId) {
        return {
          assigneeId: await this.leastLoadedOf([store.areaManager.assignedTechId]),
          areaManagerId: store.areaManager.id,
        };
      }

      // 2. LEGACY: UserStoreAccess chain (users with AREA_MANAGER role)
      const amLinks = await this.prisma.userStoreAccess.findMany({
        where: {
          storeId,
          user: { role: { code: 'AREA_MANAGER' }, isActive: true },
        },
        select: { user: { select: { id: true, managedByTechId: true } } },
      });
      const techIds = [...new Set(
        amLinks.map((a) => a.user.managedByTechId).filter((v): v is string => !!v),
      )];
      if (techIds.length) {
        return {
          assigneeId: await this.leastLoadedOf(techIds),
          areaManagerId: null,
        };
      }
    }

    // 3. Fallback: category default
    const cat = await this.prisma.ticketCategory.findUnique({
      where: { id: categoryId }, select: { defaultAssigneeId: true },
    });
    return { assigneeId: cat?.defaultAssigneeId ?? null, areaManagerId: null };
  }

  /** @deprecated use pickRoute — kept for callers until migration is complete */
  async pickAutoAssignee(opts: { storeId?: string | null; categoryId: string }): Promise<string | null> {
    return (await this.pickRoute(opts)).assigneeId;
  }

  private async leastLoadedOf(techIds: string[]): Promise<string | null> {
    if (techIds.length === 0) return null;
    if (techIds.length === 1) return techIds[0];
    const loads = await Promise.all(techIds.map(async (id) => ({
      id,
      open: await this.prisma.ticket.count({
        where: { assignedToId: id, status: { notIn: ['RESOLVED', 'CLOSED'] } },
      }),
    })));
    loads.sort((a, b) => a.open - b.open);
    return loads[0].id;
  }

  /** Reporting: which AM (entity OR legacy user) covers this store. */
  async areaManagersForStore(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: { areaManager: { include: { assignedTech: { select: { id: true, fullName: true } } } } },
    });
    if (store?.areaManager) {
      return [{ ...store.areaManager, kind: 'entity' as const }];
    }
    // Fallback to legacy
    const rows = await this.prisma.userStoreAccess.findMany({
      where: { storeId, user: { role: { code: 'AREA_MANAGER' } } },
      include: { user: { include: { role: true, managedByTech: { select: { id: true, fullName: true } } } } },
    });
    return rows.map((r) => ({ ...r.user, kind: 'user' as const }));
  }
}
