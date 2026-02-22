import { Controller, Get } from '@nestjs/common';
import { WatchtowerService } from './watchtower.service';

@Controller('watchtower')
export class WatchtowerController {
  constructor(private readonly watchtowerService: WatchtowerService) {}

  @Get('live')
  async getLiveEntries() {
    return this.watchtowerService.getAllLiveEntries();
  }
}
