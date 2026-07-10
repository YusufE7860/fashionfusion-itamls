import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export interface UpsertPcDto {
  role?: 'TILL' | 'BACKOFFICE';
  backupPaths?: string[];  // list of absolute paths on the PC
  isActive?: boolean;
}

export interface UpdateJobDto {
  scheduleCron?: string;
  retentionDays?: number;
  isActive?: boolean;
}

@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  /** Return everything the Backups page needs for a store. */
  async forStore(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        backupJob: true,
        storePcs: {
          include: {
            runs: { orderBy: { startedAt: 'desc' }, take: 1 },
          },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!store) throw new NotFoundException();
    // Ensure the job exists (auto-heal legacy stores)
    let job = store.backupJob;
    if (!job) {
      job = await this.prisma.backupJob.create({ data: { storeId } });
    }
    return {
      storeId: store.id,
      storeCode: store.code,
      storeName: store.name,
      job,
      pcs: store.storePcs.map((p) => ({
        ...p,
        backupPaths: safeParsePaths(p.backupPaths),
        lastRun: p.runs?.[0] ? this.publicRun(p.runs[0]) : null,
      })),
    };
  }

  async updateJob(storeId: string, dto: UpdateJobDto) {
    return this.prisma.backupJob.upsert({
      where: { storeId },
      create: { storeId, ...dto },
      update: dto,
    });
  }

  async upsertPc(storeId: string, name: string, dto: UpsertPcDto) {
    const paths = dto.backupPaths ? JSON.stringify(dto.backupPaths) : undefined;
    return this.prisma.storePc.upsert({
      where: { storeId_name: { storeId, name } },
      create: {
        storeId, name,
        role: dto.role ?? 'TILL',
        backupPaths: paths ?? '[]',
        isActive: dto.isActive ?? true,
      },
      update: {
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(paths !== undefined ? { backupPaths: paths } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  removePc(id: string) {
    return this.prisma.storePc.delete({ where: { id } });
  }

  /** Recent runs across all stores — for the admin dashboard. */
  recent(limit = 100) {
    return this.prisma.backupRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: { pc: { include: { store: true } } },
    });
  }

  async downloadUrl(runId: string) {
    const r = await this.prisma.backupRun.findUnique({ where: { id: runId } });
    if (!r?.storagePath) throw new NotFoundException('No file for this run');
    return this.storage.presignedGet(r.storagePath, 5 * 60);
  }

  private publicRun(r: any) {
    return {
      id: r.id,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      sizeBytes: r.sizeBytes?.toString?.() ?? '0',
      error: r.error,
    };
  }
}

function safeParsePaths(s: string): string[] {
  try { const parsed = JSON.parse(s); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
