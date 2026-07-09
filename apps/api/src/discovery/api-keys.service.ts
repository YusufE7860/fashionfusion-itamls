import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ApiKeysService {
  constructor(private prisma: PrismaService) {}

  static hash(raw: string) {
    return createHash('sha256').update(raw).digest('hex');
  }

  list() {
    return this.prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, label: true, prefix: true, scope: true,
        createdAt: true, lastUsedAt: true, revokedAt: true, createdById: true,
      },
    });
  }

  async create(label: string, scope = 'DISCOVERY', createdById?: string) {
    // Format: itamls_<32 hex chars>. Prefix shown to user; full key shown once.
    const raw = `itamls_${randomBytes(24).toString('hex')}`;
    const prefix = raw.slice(0, 12);
    const keyHash = ApiKeysService.hash(raw);
    const rec = await this.prisma.apiKey.create({
      data: { label, prefix, keyHash, scope, createdById },
    });
    return { id: rec.id, label, scope, prefix, key: raw };
  }

  async revoke(id: string) {
    const k = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!k) throw new NotFoundException();
    return this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  async validate(raw: string) {
    if (!raw) return null;
    const keyHash = ApiKeysService.hash(raw);
    const k = await this.prisma.apiKey.findUnique({ where: { keyHash } });
    if (!k || k.revokedAt) return null;
    await this.prisma.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } });
    return k;
  }
}
