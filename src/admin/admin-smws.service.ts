import { ConflictException, Injectable } from '@nestjs/common';
import { SmwsBottleSyncService } from '../tasteep/smws-bottles/smws-bottle-sync.service';
import {
  SmwsAdminStatus,
  SmwsBottlesService,
} from '../tasteep/smws-bottles/smws-bottles.service';

/** `/admin/smws`: bottle counts, recent scraper runs, manual trigger. */
@Injectable()
export class AdminSmwsService {
  constructor(
    private readonly bottles: SmwsBottlesService,
    private readonly sync: SmwsBottleSyncService,
  ) {}

  status(): Promise<SmwsAdminStatus> {
    return this.bottles.adminStatus();
  }

  /**
   * Starts a scrape without waiting for it. The sync service flags itself
   * running synchronously, so a second call before it finishes gets a 409.
   * `run()` never rejects; failures land on the run row.
   */
  start(): void {
    if (this.sync.isRunning()) {
      throw new ConflictException('The SMWS scraper is already running.');
    }
    void this.sync.run('admin');
  }
}
