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
  AddFlavourAliasDto,
  CreateFlavourDto,
  UpdateFlavourDto,
} from '../tasteep/flavours/dto/flavour.dto';
import type { FlavourSeedFile } from '../tasteep/flavours/flavour.rules';
import { FlavoursService } from '../tasteep/flavours/flavours.service';
import { AdminAuditService } from './admin-audit.service';
import type { AdminAuthRequest } from './admin-auth.guard';
import { AdminProtected, AdminQuery } from './admin-protected.decorator';
import {
  FlavoursQueryDto,
  UnmatchedTagsQueryDto,
} from './dto/admin-queries.dto';
import {
  AdminFlavourRowJson,
  AdminFlavourTreeJson,
  FlavourReindexJson,
  UnmatchedTagsJson,
} from './dto/admin-responses.dto';

/**
 * The flavour vocabulary (`tasteep_flavours`) that tasting tags are matched
 * against. Every change recomputes `flavour_ids` of all tagged tastings before
 * it returns, and changes `GET /tasteep/flavours` and its ETag.
 *
 * Flavour ids contain a `/` (`smoky/peat`): URL-encode them in the path
 * (`/admin/flavours/smoky%2Fpeat`).
 */
@ApiTags('admin')
@Controller('admin/flavours')
@AdminProtected()
export class AdminFlavoursController {
  constructor(
    private readonly flavours: FlavoursService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  tree(@AdminQuery() query: FlavoursQueryDto): Promise<AdminFlavourTreeJson[]> {
    return this.flavours.adminTree(query);
  }

  /** Tags no flavour matches, most widely used first: map them with `POST :id/aliases`. */
  @Get('unmatched')
  unmatched(
    @AdminQuery() query: UnmatchedTagsQueryDto,
  ): Promise<UnmatchedTagsJson> {
    return this.flavours.unmatched(query.limit ?? 100);
  }

  /** The table in the seed file's format: save it over `flavours.json` and commit. */
  @Get('export')
  @Header('Content-Disposition', 'attachment; filename="flavours.json"')
  export(): Promise<FlavourSeedFile> {
    return this.flavours.exportSeedFile();
  }

  /** Recomputes every tasting's `flavour_ids`. Edits already do this; it's for repairs. */
  @Post('reindex')
  @HttpCode(HttpStatus.OK)
  async reindex(@Req() req: AdminAuthRequest): Promise<FlavourReindexJson> {
    const result = await this.flavours.reindex();
    this.audit.record(req.admin.email, 'reindex-flavours', '(all)');
    return result;
  }

  @Post()
  async create(
    @Body() dto: CreateFlavourDto,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminFlavourRowJson> {
    const row = await this.flavours.create(dto);
    this.audit.record(req.admin.email, 'create-flavour', row.id);
    return row;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFlavourDto,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminFlavourRowJson> {
    const row = await this.flavours.update(id, dto);
    this.audit.record(req.admin.email, 'update-flavour', id);
    return row;
  }

  /** Adds one spelling; `409` if another flavour already answers to it. */
  @Post(':id/aliases')
  @HttpCode(HttpStatus.OK)
  async addAlias(
    @Param('id') id: string,
    @Body() dto: AddFlavourAliasDto,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminFlavourRowJson> {
    const row = await this.flavours.addAlias(id, dto.alias);
    this.audit.record(
      req.admin.email,
      'alias-flavour',
      `${id} ${JSON.stringify(dto.alias)}`,
    );
    return row;
  }

  /** Soft delete, with the category's flavours. Their ids leave `flavour_ids`; `tags` are untouched. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @Req() req: AdminAuthRequest,
  ): Promise<void> {
    await this.flavours.remove(id);
    this.audit.record(req.admin.email, 'delete-flavour', id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @Param('id') id: string,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminFlavourRowJson> {
    const row = await this.flavours.restore(id);
    this.audit.record(req.admin.email, 'restore-flavour', id);
    return row;
  }
}
