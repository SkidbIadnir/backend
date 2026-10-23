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
  CreateSmwsCodeDto,
  UpdateSmwsCodeDto,
} from '../tasteep/smws-codes/dto/smws-code.dto';
import { SmwsCodesService } from '../tasteep/smws-codes/smws-codes.service';
import type { SmwsCodeSeedFile } from '../tasteep/smws-codes/smws-codes.service';
import { AdminAuditService } from './admin-audit.service';
import type { AdminAuthRequest } from './admin-auth.guard';
import { AdminProtected, AdminQuery } from './admin-protected.decorator';
import { SmwsCodesQueryDto } from './dto/admin-queries.dto';
import {
  AdminSmwsCodeJson,
  AdminSmwsCodePage,
  SmwsCodesDiffJson,
} from './dto/admin-responses.dto';

/**
 * The SMWS code list the app caches offline (`tasteep_smws_codes`). Edits
 * here change what `GET /tasteep/smws-codes` serves, and so its `version`.
 */
@ApiTags('admin')
@Controller('admin/smws-codes')
@AdminProtected()
export class AdminSmwsCodesController {
  constructor(
    private readonly codes: SmwsCodesService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  list(@AdminQuery() query: SmwsCodesQueryDto): Promise<AdminSmwsCodePage> {
    return this.codes.list(query);
  }

  /** Where the table and `src/tasteep/data/smws-codes.json` disagree. */
  @Get('diff')
  diff(): Promise<SmwsCodesDiffJson> {
    return this.codes.diff();
  }

  /** The table in the seed file's format: save it over `smws-codes.json` and commit. */
  @Get('export')
  @Header('Content-Disposition', 'attachment; filename="smws-codes.json"')
  export(): Promise<SmwsCodeSeedFile> {
    return this.codes.exportSeedFile();
  }

  @Post()
  async create(
    @Body() dto: CreateSmwsCodeDto,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminSmwsCodeJson> {
    const row = await this.codes.create(dto);
    this.audit.record(req.admin.email, 'create-smws-code', row.code);
    return row;
  }

  @Patch(':code')
  async update(
    @Param('code') code: string,
    @Body() dto: UpdateSmwsCodeDto,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminSmwsCodeJson> {
    const row = await this.codes.update(code, dto);
    this.audit.record(req.admin.email, 'update-smws-code', code);
    return row;
  }

  /** Soft delete: the code leaves the app's list and the seed won't re-add it. */
  @Delete(':code')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('code') code: string,
    @Req() req: AdminAuthRequest,
  ): Promise<void> {
    await this.codes.remove(code);
    this.audit.record(req.admin.email, 'delete-smws-code', code);
  }

  @Post(':code/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @Param('code') code: string,
    @Req() req: AdminAuthRequest,
  ): Promise<AdminSmwsCodeJson> {
    const row = await this.codes.restore(code);
    this.audit.record(req.admin.email, 'restore-smws-code', code);
    return row;
  }
}
