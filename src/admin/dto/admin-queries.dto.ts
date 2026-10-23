import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AUTH_PROVIDERS } from '../../tasteep/entities/tasteep-user.entity';
import type { AuthProvider } from '../../tasteep/entities/tasteep-user.entity';
import { TASTING_CATEGORIES } from '../../tasteep/entities/tasteep-tasting.entity';
import type { TastingCategory } from '../../tasteep/entities/tasteep-tasting.entity';
import { LOG_LEVELS } from '../logging/log-buffer';
import type { LogLevel } from '../logging/log-buffer';
import { PaginationQueryDto, QueryBoolean } from './pagination.dto';

export class UsersQueryDto extends PaginationQueryDto {
  /** Substring match on email or display name. */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(AUTH_PROVIDERS)
  provider?: AuthProvider;
}

export class TastingsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @IsOptional()
  @IsIn(TASTING_CATEGORIES)
  category?: TastingCategory;

  /** Only tastings whose location precision is `unknown` or `country`. */
  @IsOptional()
  @QueryBoolean()
  unplaced?: boolean;
}

export class LogsQueryDto {
  @IsOptional()
  @IsIn(LOG_LEVELS)
  level?: LogLevel;

  @IsOptional()
  @IsString()
  context?: string;

  @IsOptional()
  @IsISO8601()
  since?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}
