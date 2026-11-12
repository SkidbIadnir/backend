import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import {
  TasteepTasting,
  UNPLACED_PRECISIONS,
} from '../entities/tasteep-tasting.entity';
import { UpsertTastingDto } from './dto/upsert-tasting.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { RegionsService } from '../regions/regions.service';
import { SmwsBottlesService } from '../smws-bottles/smws-bottles.service';
import { PhotoStorageService } from '../photos/photo-storage.service';
import { processPhoto } from '../photos/photo-processor';
import { applyUpsertDto, TastingJson, toTastingJson } from './tasting.mapper';
import {
  codeInName,
  TastingPrefillJson,
  toTastingPrefill,
} from './tasting-prefill';

export interface TastingStats {
  count: number;
  avg_score: number | null;
  distinct_distilleries: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * `photo_id` is only written by `setPhoto`/`removePhoto`. TypeORM's `save`
 * writes back every loaded column that differs from the database, so a
 * tasting PUT racing a photo upload would restore the old id; `undefined`
 * columns are skipped.
 */
const withoutPhoto = (t: TasteepTasting): TasteepTasting => ({
  ...t,
  photoId: undefined as unknown as null,
});

@Injectable()
export class TastingsService {
  constructor(
    @InjectRepository(TasteepTasting)
    private readonly repo: Repository<TasteepTasting>,
    private readonly regions: RegionsService,
    private readonly bottles: SmwsBottlesService,
    private readonly photos: PhotoStorageService,
  ) {}

  /**
   * Newest `date_tasted` first; undated entries last. `unplaced` keeps only
   * `unknown`/`country` precision; `smwsSku` the tastings of one bottle;
   * `smwsDistillery` those of one SMWS distillery code (`29`).
   */
  async list(
    userId: string,
    options: {
      unplaced?: boolean;
      smwsSku?: string;
      smwsDistillery?: string;
    } = {},
  ): Promise<TastingJson[]> {
    const rows = await this.repo.find({
      where: {
        userId,
        ...(options.unplaced
          ? { locationPrecision: In(UNPLACED_PRECISIONS) }
          : {}),
        ...(options.smwsSku ? { smwsSku: options.smwsSku } : {}),
        ...(options.smwsDistillery
          ? {
              smwsBottle: {
                distilleryCode: options.smwsDistillery.toUpperCase(),
              },
            }
          : {}),
      },
      relations: { smwsBottle: true },
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
    target.smwsSku = await this.bottleLink(dto, target);

    const region = await this.regions.resolve(dto.region_id, dto.region);
    target.regionId = region?.id ?? null;
    if (region && !target.region) target.region = region.name;

    if (pinned && target.locationPrecision !== 'manual') {
      target.lat = pinned.lat;
      target.lon = pinned.lon;
      target.locationPrecision = 'manual';
    }

    await this.repo.save(withoutPhoto(target));
    return toTastingJson(await this.findOwned(userId, id));
  }

  /**
   * A new tasting's fields from a catalog bottle (cask code or SKU), with the
   * user's earlier tastings of it. `404` if the bottle is unknown.
   */
  async prefill(userId: string, bottle: string): Promise<TastingPrefillJson> {
    const row = await this.bottles.findRow(bottle);
    const previous = await this.repo.find({
      where: { userId, smwsSku: row.sku },
      order: {
        dateTasted: { direction: 'DESC', nulls: 'LAST' },
        createdAt: 'DESC',
      },
    });
    return toTastingPrefill(
      row,
      previous.map((t) => ({
        id: t.id,
        name: t.name,
        date_tasted: t.dateTasted ? new Date(t.dateTasted).toISOString() : null,
        score: t.score ?? null,
      })),
    );
  }

  /**
   * The bottle link to store: the body's `smws_sku` (a SKU or cask code,
   * `400` if unknown), `null` to unlink; when the key is left out, the stored
   * link, else the bottle whose cask code starts the name.
   */
  private async bottleLink(
    dto: UpsertTastingDto,
    target: TasteepTasting,
  ): Promise<string | null> {
    if (dto.smws_sku === null) return null;
    if (dto.smws_sku !== undefined) {
      const row = await this.bottles.findRowOrNull(dto.smws_sku);
      if (!row) {
        throw new BadRequestException(`Unknown smws_sku "${dto.smws_sku}".`);
      }
      return row.sku;
    }
    if (target.smwsSku) return target.smwsSku;
    const code = codeInName(target.name);
    return code
      ? ((await this.bottles.findRowOrNull(code))?.sku ?? null)
      : null;
  }

  /** Deletes the tasting, then its photo files. */
  async remove(userId: string, id: string): Promise<void> {
    const tasting = await this.repo.findOne({ where: { id, userId } });
    if (!tasting) {
      throw new NotFoundException('Tasting not found.');
    }
    await this.repo.delete({ id, userId });
    if (tasting.photoId) await this.photos.remove(tasting.photoId);
  }

  /**
   * Stores `upload` as the tasting's photo, replacing any previous one. The
   * new files are written before the row points at them and the old files
   * are deleted after, so a failure never leaves the row on a missing file.
   */
  async setPhoto(
    userId: string,
    id: string,
    upload: Buffer,
  ): Promise<TastingJson> {
    const tasting = await this.findOwned(userId, id);
    const processed = await processPhoto(upload);

    const photoId = randomUUID();
    await this.photos.save(photoId, processed);
    try {
      await this.repo.update({ id, userId }, { photoId });
    } catch (err) {
      await this.photos.remove(photoId);
      throw err;
    }
    if (tasting.photoId) await this.photos.remove(tasting.photoId);
    return toTastingJson(await this.findOwned(userId, id));
  }

  /** Detaches and deletes the uploaded photo. A no-op when there is none. */
  async removePhoto(userId: string, id: string): Promise<TastingJson> {
    const tasting = await this.findOwned(userId, id);
    if (tasting.photoId) {
      await this.repo.update({ id, userId }, { photoId: null });
      await this.photos.remove(tasting.photoId);
    }
    return toTastingJson(await this.findOwned(userId, id));
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

    await this.repo.save(withoutPhoto(tasting));
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
    const tasting = await this.repo.findOne({
      where: { id, userId },
      relations: { smwsBottle: true },
    });
    if (!tasting) {
      throw new NotFoundException('Tasting not found.');
    }
    return tasting;
  }
}
