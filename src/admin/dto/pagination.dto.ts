import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

export class Page<T> {
  items: T[];
  total: number;
}

/** `?flag=true` / `?flag=1` → true; anything else → false. */
export const QueryBoolean = () =>
  Transform(({ value }) => value === true || value === 'true' || value === '1');
