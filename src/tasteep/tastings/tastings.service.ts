import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  TasteepTasting,
  UNPLACED_PRECISIONS,
} from '../entities/tasteep-tasting.entity';
import { UpsertTastingDto } from './dto/upsert-tasting.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { RegionsService } from '../regions/regions.service';
import { applyUpsertDto, TastingJson, toTastingJson } from './tasting.mapper';

export interface TastingStats {
  count: number;
  avg_score: number | null;
  distinct_distilleries: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

@Injectable()
export class TastingsService {
  constructor(
    @InjectRepository(TasteepTasting)
    private readonly repo: Repository<TasteepTasting>,
    private readonly regions: RegionsService,
  ) {}

  /** Newest `date_tasted` first; undated entries last. `unplaced` keeps only `unknown`/`country` precision. */
  async list(
    userId: string,
    options: { unplaced?: boolean } = {},
  ): Promise<TastingJson[]> {
    const rows = await this.repo.find({
      where: {
        userId,
        ...(options.unplaced
          ? { locationPrecision: In(UNPLACED_PRECISIONS) }
          : {}),
      },
      order: {
        dateTasted: { direction: 'DESC', nulls: 'LAST' },
        createdAt: 'DESC',
      },
    });
    return rows.map(toTastingJson);
  }

  async get(userId: string, id: string): Promise<TastingJson> {
    return toTastingJson(await this.findOwned(userId, id));
  }

  /**
   * Create-or-replace. The client owns the id. `created_at` is set only on
   * first insert; `updated_at` always bumps. A `manual` location pin on the
   * existing row survives an automated (non-manual) precision in the body.
   *
   * Region: `region_id` (from the picker) wins and must exist; otherwise the
   * free-text `region` is matched by name. Picking without text fills the
   * text with the region's name so the journal stays readable.
   */
  async upsert(
    userId: string,
    id: string,
    dto: UpsertTastingDto,
  ): Promise<TastingJson> {
    const existing = await this.repo.findOne({ where: { id } });
    if (existing && existing.userId !== userId) {
      throw new ConflictException(
        'This id is already used by another account.',
      );
    }

    const target = existing ?? this.repo.create({ id, userId });
    const pinned =
      existing?.locationPrecision === 'manual'
        ? { lat: existing.lat, lon: existing.lon }
        : null;

    applyUpsertDto(target, dto);

    const region = await this.regions.resolve(dto.region_id, dto.region);
    target.regionId = region?.id ?? null;
    if (region && !target.region) target.region = region.name;

    if (pinned && target.locationPrecision !== 'manual') {
      target.lat = pinned.lat;
      target.lon = pinned.lon;
      target.locationPrecision = 'manual';
    }

    await this.repo.save(target);
    return toTastingJson(await this.findOwned(userId, id));
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.repo.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException('Tasting not found.');
    }
  }

  /** Pin-drop / geocode-result / clear. See `UpdateLocationDto` for the rules. */
  async updateLocation(
    userId: string,
    id: string,
    dto: UpdateLocationDto,
  ): Promise<TastingJson> {
    const tasting = await this.findOwned(userId, id);

    if (dto.precision === 'unknown') {
      tasting.lat = null;
      tasting.lon = null;
      tasting.locationPrecision = 'unknown';
    } else {
      if (dto.lat == null || dto.lon == null) {
        throw new BadRequestException(
          `lat and lon are required for precision "${dto.precision}".`,
        );
      }
      const automated = dto.precision !== 'manual';
      if (automated && tasting.locationPrecision === 'manual') {
        throw new ConflictException(
          'This tasting was pinned manually; automated geocode results do not overwrite it.',
        );
      }
      tasting.lat = dto.lat;
      tasting.lon = dto.lon;
      tasting.locationPrecision = dto.precision;
    }

    await this.repo.save(tasting);
    return toTastingJson(await this.findOwned(userId, id));
  }

  async stats(userId: string): Promise<TastingStats> {
    const raw = await this.repo
      .createQueryBuilder('t')
      .select('COUNT(*)', 'count')
      .addSelect('AVG(t.score)', 'avg_score')
      .addSelect('COUNT(DISTINCT t.distillery)', 'distinct_distilleries')
      .where('t.userId = :userId', { userId })
      .getRawOne<{
        count: string;
        avg_score: string | null;
        distinct_distilleries: string;
      }>();

    return {
      count: parseInt(raw?.count ?? '0', 10),
      avg_score:
        raw?.avg_score == null ? null : round1(parseFloat(raw.avg_score)),
      distinct_distilleries: parseInt(raw?.distinct_distilleries ?? '0', 10),
    };
  }

  private async findOwned(userId: string, id: string): Promise<TasteepTasting> {
    const tasting = await this.repo.findOne({ where: { id, userId } });
    if (!tasting) {
      throw new NotFoundException('Tasting not found.');
    }
    return tasting;
  }
}
