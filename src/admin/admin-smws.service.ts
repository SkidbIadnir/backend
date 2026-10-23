import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SmwsArchive } from '../smws/entities/smws-archive.entity';
import { SmwsDistillery } from '../smws/entities/smws-distillery.entity';
import { SmwsLive } from '../smws/entities/smws-live.entity';
import { SmwsLookout } from '../smws/entities/smws-lookout.entity';
import {
  ScraperRunState,
  ScraperService,
} from '../smws/scraper/scraper.service';

export type ScraperKind = 'live' | 'archive';

type LiveRow = {
  total: string;
  available: string;
  new: string;
  updated_at: Date | null;
};
type ArchiveRow = { total: string; new: string; updated_at: Date | null };
type DistilleryRow = { total: string; updated_at: Date | null };

const iso = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString() : null;
const runJson = (s: ScraperRunState) => ({
  running: s.running,
  last_started_at: iso(s.lastStartedAt),
  last_finished_at: iso(s.lastFinishedAt),
  last_error: s.lastError,
});

@Injectable()
export class AdminSmwsService {
  private readonly logger = new Logger(AdminSmwsService.name);

  constructor(
    @InjectRepository(SmwsLive)
    private readonly liveRepo: Repository<SmwsLive>,
    @InjectRepository(SmwsArchive)
    private readonly archiveRepo: Repository<SmwsArchive>,
    @InjectRepository(SmwsDistillery)
    private readonly distilleryRepo: Repository<SmwsDistillery>,
    @InjectRepository(SmwsLookout)
    private readonly lookoutRepo: Repository<SmwsLookout>,
    private readonly scraper: ScraperService,
  ) {}

  async status() {
    const [live, archive, distilleries, lookout] = await Promise.all([
      this.liveRepo
        .createQueryBuilder('l')
        .select('COUNT(*)', 'total')
        .addSelect('COUNT(*) FILTER (WHERE l.available)', 'available')
        .addSelect('COUNT(*) FILTER (WHERE l.is_new)', 'new')
        .addSelect('MAX(l.updated_at)', 'updated_at')
        .getRawOne<LiveRow>(),
      this.archiveRepo
        .createQueryBuilder('a')
        .select('COUNT(*)', 'total')
        .addSelect('COUNT(*) FILTER (WHERE a.is_new)', 'new')
        .addSelect('MAX(a.updated_at)', 'updated_at')
        .getRawOne<ArchiveRow>(),
      this.distilleryRepo
        .createQueryBuilder('d')
        .select('COUNT(*)', 'total')
        .addSelect('MAX(d.updated_at)', 'updated_at')
        .getRawOne<DistilleryRow>(),
      this.lookoutRepo.count(),
    ]);
    const runs = this.scraper.getRunState();
    // Aggregates without GROUP BY always yield exactly one row.
    if (!live || !archive || !distilleries) throw new Error('No stats row');
    return {
      live: {
        total: Number(live.total),
        available: Number(live.available),
        new: Number(live.new),
        updated_at: iso(live.updated_at),
      },
      archive: {
        total: Number(archive.total),
        new: Number(archive.new),
        updated_at: iso(archive.updated_at),
      },
      distilleries: {
        total: Number(distilleries.total),
        updated_at: iso(distilleries.updated_at),
      },
      lookout: { total: lookout },
      scraper: { live: runJson(runs.live), archive: runJson(runs.archive) },
    };
  }

  /**
   * Starts a scrape without waiting for it. The service sets its running flag
   * synchronously, so a second call before it finishes gets a 409 here.
   */
  start(kind: ScraperKind): void {
    if (this.scraper.getRunState()[kind].running) {
      throw new ConflictException(`The ${kind} scraper is already running.`);
    }
    const run =
      kind === 'live'
        ? this.scraper.runScraper()
        : this.scraper.runArchiveScraper();
    run.catch((e: Error) =>
      this.logger.error(`Manual ${kind} scraper run failed: ${e.message}`),
    );
  }
}
