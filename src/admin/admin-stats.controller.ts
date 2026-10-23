import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminProtected } from './admin-protected.decorator';
import { AdminStatsService } from './admin-stats.service';
import { OtpStatsJson, StatsOverviewJson } from './dto/admin-responses.dto';

@ApiTags('admin')
@Controller('admin')
@AdminProtected()
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsService) {}

  @Get('stats/overview')
  overview(): Promise<StatsOverviewJson> {
    return this.stats.overview();
  }

  @Get('auth/otps/stats')
  otpStats(): Promise<OtpStatsJson> {
    return this.stats.otpStats();
  }
}
