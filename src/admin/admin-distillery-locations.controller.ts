import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CreateDistilleryLocationDto,
  UpdateDistilleryLocationDto,
} from '../tasteep/geocode/dto/distillery-location.dto';
import { DistilleryLocationsService } from '../tasteep/geocode/distillery-locations.service';
import type { DistillerySeedFile } from '../tasteep/geocode/distillery-locations.service';
import { AdminAuditService } from './admin-audit.service';
import type { AdminAuthRequest } from './admin-auth.guard';
import { AdminProtected, AdminQuery } from './admin-protected.decorator';
import { DistilleryLocationsQueryDto } from './dto/admin-queries.dto';
import {
  AdminDistilleryLocationPage,
  AdminDistilleryLocationWriteJson,
  DistilleryLocationAppliedJson,
  DistilleryLocationDeletedJson,
  SeedDiffJson,
} from './dto/admin-responses.dto';

/**
 * Curated distillery coordinates (`tasteep_distillery_locations`), checked
 * before Nominatim. Every write evicts the geocode cache rows the name
 * matches and says how many (`cache_cleared`), so the next lookup of a
 * cached miss hits the curated row.
 */
@ApiTags('admin')
@Controller('admin/distillery-locations')
@AdminProtected()
export class AdminDistilleryLocationsController {
  constructor(
    private readonly locations: DistilleryLocationsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  list(
    @AdminQuery() query: DistilleryLocationsQueryDto,
  ): Promise<AdminDistilleryLocationPage> {
    return this.locations.list(query);
  }

  /** Where the table and `src/tasteep/data/distillery-location.json` disagree. */
  @Get('diff')
  diff(): Promise<SeedDiffJson> {
    return this.locations.diff();
  }

  /** The table in the seed file's format: save it over `distillery-location.json` and commit. */
  @Get('export')
  @Header(
    'Content-Disposition',
    'attachment; filename="distillery-location.json"',
  )
  export(): Promise<DistillerySeedFile> {
    return this.locations.exportSeedFile();
  }

  @Post()
  async create(
    @Body() dto: CreateDistilleryLocationDto,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminDistilleryLocationWriteJson> {
    const row = await this.locations.create(dto);
    this.audit.record(req.admin.email, 'create-distillery-location', row.id);
    return row;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDistilleryLocationDto,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminDistilleryLocationWriteJson> {
    const row = await this.locations.update(id, dto);
    this.audit.record(req.admin.email, 'update-distillery-location', id);
    return row;
  }

  /** Soft delete: geocoding stops using the row and the seed won't re-add it. */
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: AdminAuthRequest,
  ): Promise<DistilleryLocationDeletedJson> {
    const result = await this.locations.remove(id);
    this.audit.record(req.admin.email, 'delete-distillery-location', id);
    return result;
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @Param('id') id: string,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminDistilleryLocationWriteJson> {
    const row = await this.locations.restore(id);
    this.audit.record(req.admin.email, 'restore-distillery-location', id);
    return row;
  }

  /** Places the already-unplaced tastings whose distillery this row matches; `manual` pins are left alone. */
  @Post(':id/apply')
  @HttpCode(HttpStatus.OK)
  async apply(
    @Param('id') id: string,
    @Req() req: AdminAuthRequest,
  ): Promise<DistilleryLocationAppliedJson> {
    const result = await this.locations.apply(id);
    this.audit.record(
      req.admin.email,
      'apply-distillery-location',
      `${id} (${result.updated} tasting(s))`,
    );
    return result;
  }
}
