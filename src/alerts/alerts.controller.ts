import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { UpdateAlertDto } from './dto/update-alert.dto';

interface AuthenticatedRequest extends Request {
  user: { sub: string; discordId: string };
}

@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  getAlerts(@Req() req: AuthenticatedRequest) {
    this.assertDiscordId(req.user.discordId);
    return this.alertsService.findByUser(req.user.discordId);
  }

  @Post()
  createAlert(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateAlertDto,
  ) {
    this.assertDiscordId(req.user.discordId);
    return this.alertsService.create(
      req.user.discordId,
      dto.alertType,
      dto.alertValue,
      undefined,
      dto.name,
    );
  }

  @Patch(':id')
  updateAlert(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAlertDto,
  ) {
    this.assertDiscordId(req.user.discordId);
    return this.alertsService.update(id, req.user.discordId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAlert(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.assertDiscordId(req.user.discordId);
    return this.alertsService.remove(id, req.user.discordId);
  }

  @Get(':id/matches')
  getMatches(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    this.assertDiscordId(req.user.discordId);
    return this.alertsService.getMatches(id, req.user.discordId);
  }

  private assertDiscordId(discordId: string | undefined): void {
    if (!discordId) {
      throw new UnauthorizedException(
        'Please log in again to refresh your session.',
      );
    }
  }
}
