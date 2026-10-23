import {
  applyDecorators,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AdminGuard } from './admin-auth.guard';

/** Throttle first so failed auth attempts count against the limit, then authenticate. */
export const AdminProtected = () =>
  applyDecorators(UseGuards(ThrottlerGuard, AdminGuard), ApiBearerAuth());

/**
 * `@Query()` with transformation on. The global pipe doesn't set `transform`,
 * so without this `?limit=10` would reach the handler as the string "10".
 */
export const AdminQuery = () =>
  Query(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
