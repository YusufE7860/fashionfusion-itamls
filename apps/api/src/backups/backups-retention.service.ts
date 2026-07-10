import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Deletes backup runs (and their MinIO objects) older than each store's retentionDays.
 * Runs daily at 03:30, after the alerts scan.
 */
@Injectable()
export class BackupsRetentionService {
  private readonly logger = new Logger(BackupsRetentionService.name);
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  @Cron('30 3 * * *')
  async purgeOld() {
    this.logger.log('Backup retention scan starting');
    const jobs = await this.prisma.backupJob.findMany();
    let removed = 0;
    for (const job of jobs) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - job.retentionDays);
      const old = await this.prisma.backupRun.findMany({
        where: { pc: { storeId: job.storeId }, startedAt: { lt: cutoff } },
      });
      for (const r of old) {
        if (r.storagePath) {
          try { await this.storage.remove(r.storagePath); } catch (e: any) {
            this.logger.warn(`Could not remove ${r.storagePath}: ${e.message}`);
          }
        }
        await this.prisma.backupRun.delete({ where: { id: r.id } });
        removed++;
      }
    }
    this.logger.log(`Backup retention scan complete — removed ${removed} old runs`);
  }
}
