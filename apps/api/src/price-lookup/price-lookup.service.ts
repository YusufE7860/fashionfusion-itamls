import { Injectable, Logger } from '@nestjs/common';
import { PriceLookupResult, buildProvider } from './providers';

interface CacheEntry { result: PriceLookupResult; at: number; }

@Injectable()
export class PriceLookupService {
  private provider = buildProvider();
  private cache = new Map<string, CacheEntry>();
  private readonly logger = new Logger(PriceLookupService.name);
  /** 30-day cache — prices don't fluctuate enough day-to-day to justify a re-charge. */
  private readonly TTL_MS = 30 * 24 * 60 * 60 * 1000;

  constructor() {
    this.logger.log(`Price lookup provider: ${this.provider.name}`);
  }

  async lookup(manufacturer: string, model: string): Promise<PriceLookupResult> {
    const key = `${manufacturer.toLowerCase()}|${model.toLowerCase()}`.trim();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.TTL_MS) return hit.result;
    const result = await this.provider.lookup(manufacturer, model);
    this.cache.set(key, { result, at: Date.now() });
    return result;
  }
}
