import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuditService } from './admin-audit.service';
import type { AdminAuthRequest } from './admin-auth.guard';
import { AdminProtected, AdminQuery } from './admin-protected.decorator';
import { AdminUsersService } from './admin-users.service';
import { UsersQueryDto } from './dto/admin-queries.dto';
import {
  AdminUserDetailJson,
  AdminUserPage,
  RevokeAllResultJson,
  RevokeSessionResultJson,
} from './dto/admin-responses.dto';

@ApiTags('admin')
@Controller('admin')
@AdminProtected()
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('users')
  list(@AdminQuery() query: UsersQueryDto): Promise<AdminUserPage> {
    return this.users.list(query);
  }

  @Get('users/:id')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDetailJson> {
    return this.users.detail(id);
  }

  @Post('sessions/:id/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AdminAuthRequest,
  ): Promise<RevokeSessionResultJson> {
    const result = await this.users.revokeSession(id);
    this.audit.record(req.admin.email, 'revoke-session', id);
    return result;
  }

  @Post('users/:id/revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeAll(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AdminAuthRequest,
  ): Promise<RevokeAllResultJson> {
    const result = await this.users.revokeAll(id);
    this.audit.record(req.admin.email, 'revoke-all-sessions', id);
    return result;
  }
}
