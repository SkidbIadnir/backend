import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import {
  TASTEEP_JWT_STRATEGY,
  TasteepJwtPayload,
} from './tasteep-jwt.strategy';

@Injectable()
export class TasteepJwtAuthGuard extends AuthGuard(TASTEEP_JWT_STRATEGY) {}

export interface TasteepAuthRequest extends Request {
  user: TasteepJwtPayload;
}
