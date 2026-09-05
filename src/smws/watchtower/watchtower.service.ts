import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SmwsLive } from '../entities/smws-live.entity';
import { SmwsArchive } from '../entities/smws-archive.entity';

/** Read-only access to the scraped inventory for the website. */
@Injectable()
export class WatchtowerService {
  private readonly logger = new Logger(WatchtowerService.name);

  constructor(
    @InjectRepository(SmwsLive)
    private readonly liveRepo: Repository<SmwsLive>,
    @InjectRepository(SmwsArchive)
    private readonly archiveRepo: Repository<SmwsArchive>,
  ) {}

  async getAllLiveEntries(): Promise<SmwsLive[]> {
    try {
      return await this.liveRepo.find({ order: { createdAt: 'DESC' } });
    } catch (error) {
      this.logger.error('Failed to fetch live entries:', error);
      throw error;
    }
  }

  async getAllArchiveEntries(): Promise<SmwsArchive[]> {
    try {
      return await this.archiveRepo.find({ order: { createdAt: 'DESC' } });
    } catch (error) {
      this.logger.error('Failed to fetch archive entries:', error);
      throw error;
    }
  }
}
