import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminProtected, AdminQuery } from './admin-protected.decorator';
import { AdminTastingsService } from './admin-tastings.service';
import { TastingsQueryDto } from './dto/admin-queries.dto';
import { PaginationQueryDto } from './dto/pagination.dto';
import { AdminTastingPage, GeocodeMissPage } from './dto/admin-responses.dto';

@ApiTags('admin')
@Controller('admin')
@AdminProtected()
export class AdminTastingsController {
  constructor(private readonly tastings: AdminTastingsService) {}

  @Get('tastings')
  list(@AdminQuery() query: TastingsQueryDto): Promise<AdminTastingPage> {
    return this.tastings.list(query);
  }

  @Get('geocode/misses')
  geocodeMisses(
    @AdminQuery() query: PaginationQueryDto,
  ): Promise<GeocodeMissPage> {
    return this.tastings.geocodeMisses(query);
  }
}
