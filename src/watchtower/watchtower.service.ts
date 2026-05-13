import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SmwsLive } from '../entities/smws-live.entity';

@Injectable()
export class WatchtowerService {
  private readonly logger = new Logger(WatchtowerService.name);

  constructor(
    @InjectRepository(SmwsLive)
    private readonly liveRepo: Repository<SmwsLive>,
  ) {}

  async getAllLiveEntries(): Promise<SmwsLive[]> {
    try {
      return await this.liveRepo.find({ order: { createdAt: 'DESC' } });
    } catch (error) {
      this.logger.error('Failed to fetch live entries:', error);
      throw error;
    }
  }
}
