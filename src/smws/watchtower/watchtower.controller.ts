import { Controller, Get } from '@nestjs/common';
import { WatchtowerService } from './watchtower.service';

/** Public, unauthenticated inventory feed for the website. */
@Controller('smws/watchtower')
export class WatchtowerController {
  constructor(private readonly watchtowerService: WatchtowerService) {}

  /** Bottles currently listed on smws.eu, newest first. */
  @Get('live')
  getLiveEntries() {
    return this.watchtowerService.getAllLiveEntries();
  }

  /** Every bottle ever seen by the archive scraper, newest first. */
  @Get('archive')
  getArchiveEntries() {
    return this.watchtowerService.getAllArchiveEntries();
  }
}
