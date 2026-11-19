import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Presence computed from (lastActiveAt, presenceStatus, presenceSetAt):
 *   - If presenceStatus is set and presenceSetAt is < 1 hour ago: honor it.
 *   - Otherwise derive from lastActiveAt:
 *       < 5 min   → AVAILABLE (green)
 *       < 30 min  → LUNCH     (yellow - probably away)
 *       else      → AWAY      (red)
 */
export type Presence = 'AVAILABLE' | 'BUSY' | 'LUNCH' | 'AWAY';

export function computePresence(u: {
  lastActiveAt?: Date | null;
  presenceStatus?: string | null;
  presenceSetAt?: Date | null;
}): Presence {
  const now = Date.now();
  // Manual status still fresh (< 1 hr)?
  if (u.presenceStatus && u.presenceSetAt
      && now - u.presenceSetAt.getTime() < 60 * 60 * 1000
      && ['AVAILABLE','BUSY','LUNCH','AWAY'].includes(u.presenceStatus)) {
    return u.presenceStatus as Presence;
  }
  if (!u.lastActiveAt) return 'AWAY';
  const idleMs = now - u.lastActiveAt.getTime();
  if (idleMs < 5  * 60 * 1000) return 'AVAILABLE';
  if (idleMs < 30 * 60 * 1000) return 'LUNCH';
  return 'AWAY';
}

/**
 * Portal scope resolver.
 *
 * Returns the list of Store IDs a given user is allowed to see in the Store
 * Portal. Used by every portal endpoint to filter rows.
 *
 * Rules:
 *   - STORE_MANAGER with User.storeId  → [that store]
 *   - STORE_MANAGER with UserStoreAccess rows → those stores (a 2IC with
 *     explicit access to multiple stores)
 *   - AREA_MANAGER with User.areaManagerId → every Store whose
 *     areaManagerId matches
 *   - Any other role calling portal routes → empty set (they shouldn't be
 *     here; the controller rejects with 403 before we get this far, but
 *     belt-and-braces)
 */
@Injectable()
export class PortalScopeService {
  constructor(private prisma: PrismaService) {}

  async storeIdsForUser(userId: string): Promise<string[]> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, storeId: true, areaManagerId: true,
        role: { select: { code: true } },
        storeAccess: { select: { storeId: true } },
      },
    });
    if (!u) throw new NotFoundException('user not found');

    const ids = new Set<string>();

    // Direct store membership
    if (u.storeId) ids.add(u.storeId);

    // Explicit extra store access (2IC pattern)
    for (const sa of u.storeAccess ?? []) ids.add(sa.storeId);

    // Area manager - fan out to every store they oversee
    if (u.role?.code === 'AREA_MANAGER' && u.areaManagerId) {
      const stores = await this.prisma.store.findMany({
        where: { areaManagerId: u.areaManagerId },
        select: { id: true },
      });
      for (const s of stores) ids.add(s.id);
    }

    return [...ids];
  }

  /** Throw if user cannot access this specific store. */
  async requireStoreAccess(userId: string, storeId: string): Promise<void> {
    const allowed = await this.storeIdsForUser(userId);
    if (!allowed.includes(storeId)) {
      throw new ForbiddenException('this store is outside your portal scope');
    }
  }
}
