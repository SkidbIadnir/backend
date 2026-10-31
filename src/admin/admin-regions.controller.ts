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
  CreateRegionDto,
  ReorderRegionsDto,
  UpdateRegionDto,
} from '../tasteep/regions/dto/region.dto';
import { RegionsService } from '../tasteep/regions/regions.service';
import type { RegionSeedFile } from '../tasteep/regions/regions.service';
import { AdminAuditService } from './admin-audit.service';
import type { AdminAuthRequest } from './admin-auth.guard';
import { AdminProtected, AdminQuery } from './admin-protected.decorator';
import { RegionsQueryDto } from './dto/admin-queries.dto';
import {
  AdminRegionRowJson,
  AdminRegionTreeJson,
  SeedDiffJson,
} from './dto/admin-responses.dto';

/**
 * The region picker (`tasteep_regions`). Edits change `GET /tasteep/regions`
 * and so its ETag; apps pick them up on their next fetch.
 *
 * Subregion ids contain a `/` (`scotland/islay`): URL-encode them in the
 * path (`/admin/regions/scotland%2Fislay`).
 */
@ApiTags('admin')
@Controller('admin/regions')
@AdminProtected()
export class AdminRegionsController {
  constructor(
    private readonly regions: RegionsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  tree(@AdminQuery() query: RegionsQueryDto): Promise<AdminRegionTreeJson[]> {
    return this.regions.adminTree(query);
  }

  /** Where the table and `src/tasteep/data/region.json` disagree. */
  @Get('diff')
  diff(): Promise<SeedDiffJson> {
    return this.regions.diff();
  }

  /** The table in the seed file's format: save it over `region.json` and commit. */
  @Get('export')
  @Header('Content-Disposition', 'attachment; filename="region.json"')
  export(): Promise<RegionSeedFile> {
    return this.regions.exportSeedFile();
  }

  @Post()
  async create(
    @Body() dto: CreateRegionDto,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminRegionRowJson> {
    const row = await this.regions.create(dto);
    this.audit.record(req.admin.email, 'create-region', row.id);
    return row;
  }

  /** Sets the order of one parent's live children (`parent_id` null → countries). Returns the new tree. */
  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  async reorder(
    @Body() dto: ReorderRegionsDto,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminRegionTreeJson[]> {
    const tree = await this.regions.reorder(dto);
    this.audit.record(
      req.admin.email,
      'reorder-regions',
      dto.parent_id ?? '(countries)',
    );
    return tree;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRegionDto,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminRegionRowJson> {
    const row = await this.regions.update(id, dto);
    this.audit.record(req.admin.email, 'update-region', id);
    return row;
  }

  /**
   * Soft delete, with the country's subregions. The row leaves the picker
   * and free-text matching; tastings and SMWS codes keep their link.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @Req() req: AdminAuthRequest,
  ): Promise<void> {
    await this.regions.remove(id);
    this.audit.record(req.admin.email, 'delete-region', id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @Param('id') id: string,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminRegionRowJson> {
    const row = await this.regions.restore(id);
    this.audit.record(req.admin.email, 'restore-region', id);
    return row;
  }
}
