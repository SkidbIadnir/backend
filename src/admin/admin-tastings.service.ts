import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TasteepGeocodeCache } from '../tasteep/entities/tasteep-geocode-cache.entity';
import {
  TasteepTasting,
  UNPLACED_PRECISIONS,
} from '../tasteep/entities/tasteep-tasting.entity';
import { PaginationQueryDto } from './dto/pagination.dto';
import { TastingsQueryDto } from './dto/admin-queries.dto';

@Injectable()
export class AdminTastingsService {
  constructor(
    @InjectRepository(TasteepTasting)
    private readonly tastingRepo: Repository<TasteepTasting>,
    @InjectRepository(TasteepGeocodeCache)
    private readonly cacheRepo: Repository<TasteepGeocodeCache>,
  ) {}

  async list(query: TastingsQueryDto) {
    const qb = this.tastingRepo
      .createQueryBuilder('t')
      .orderBy('t.createdAt', 'DESC')
      .skip(query.offset)
      .take(query.limit);
    if (query.user_id) qb.andWhere('t.userId = :uid', { uid: query.user_id });
    if (query.category) qb.andWhere('t.category = :c', { c: query.category });
    if (query.unplaced) {
      qb.andWhere('t.locationPrecision IN (:...p)', {
        p: UNPLACED_PRECISIONS,
      });
    }
    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((t) => ({
        id: t.id,
        user_id: t.userId,
        name: t.name,
        category: t.category,
        score: t.score,
        distillery: t.distillery,
        region: t.region,
        region_id: t.regionId,
        location: t.location,
        lat: t.lat,
        lon: t.lon,
        location_precision: t.locationPrecision,
        date_tasted: t.dateTasted ? t.dateTasted.toISOString() : null,
        created_at: t.createdAt.toISOString(),
      })),
      total,
    };
  }

  /** Cached geocode lookups that found nothing — candidates for a curated distillery location. */
  async geocodeMisses(query: PaginationQueryDto) {
    const [rows, total] = await this.cacheRepo.findAndCount({
      where: { lat: IsNull() },
      order: { resolvedAt: 'DESC' },
      skip: query.offset,
      take: query.limit,
    });
    return {
      items: rows.map((r) => ({
        query: r.query,
        precision: r.precision,
        provider: r.provider,
        resolved_at: r.resolvedAt.toISOString(),
      })),
      total,
    };
  }
}
