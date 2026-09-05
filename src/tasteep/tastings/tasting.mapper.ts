import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import { UpsertTastingDto } from './dto/upsert-tasting.dto';

/** Wire shape of `lib/models/tasting.dart` — snake_case keys, ISO 8601 strings. */
export interface TastingJson {
  id: string;
  name: string;
  category: TasteepTasting['category'];
  photo_path: string | null;
  distillery: string | null;
  region: string | null;
  abv: number | null;
  price: number | null;
  age_statement: string | null;
  cask_type: string | null;
  date_tasted: string | null;
  location: string | null;
  score: number | null;
  appearance: string | null;
  tags: string[];
  nose: string | null;
  palate: string | null;
  finish: string | null;
  lat: number | null;
  lon: number | null;
  location_precision: TasteepTasting['locationPrecision'];
  created_at: string | null;
  updated_at: string | null;
}

const iso = (d: Date | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

export function toTastingJson(t: TasteepTasting): TastingJson {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    photo_path: t.photoPath ?? null,
    distillery: t.distillery ?? null,
    region: t.region ?? null,
    abv: t.abv ?? null,
    price: t.price ?? null,
    age_statement: t.ageStatement ?? null,
    cask_type: t.caskType ?? null,
    date_tasted: iso(t.dateTasted),
    location: t.location ?? null,
    score: t.score ?? null,
    appearance: t.appearance ?? null,
    tags: t.tags ?? [],
    nose: t.nose ?? null,
    palate: t.palate ?? null,
    finish: t.finish ?? null,
    lat: t.lat ?? null,
    lon: t.lon ?? null,
    location_precision: t.locationPrecision ?? 'unknown',
    created_at: iso(t.createdAt),
    updated_at: iso(t.updatedAt),
  };
}

/**
 * Full-replacement semantics: a key that is absent or null in the body
 * becomes null on the row (PUT, not PATCH). Defaults apply for the three
 * non-nullable enum/array fields.
 */
export function applyUpsertDto(
  target: TasteepTasting,
  dto: UpsertTastingDto,
): TasteepTasting {
  target.name = dto.name;
  target.category = dto.category ?? 'whisky';
  target.photoPath = dto.photo_path ?? null;
  target.distillery = dto.distillery ?? null;
  target.region = dto.region ?? null;
  target.abv = dto.abv ?? null;
  target.price = dto.price ?? null;
  target.ageStatement = dto.age_statement ?? null;
  target.caskType = dto.cask_type ?? null;
  target.dateTasted = dto.date_tasted ? new Date(dto.date_tasted) : null;
  target.location = dto.location ?? null;
  target.score = dto.score ?? null;
  target.appearance = dto.appearance ?? null;
  target.tags = dto.tags ?? [];
  target.nose = dto.nose ?? null;
  target.palate = dto.palate ?? null;
  target.finish = dto.finish ?? null;
  target.lat = dto.lat ?? null;
  target.lon = dto.lon ?? null;
  target.locationPrecision = dto.location_precision ?? 'unknown';
  return target;
}
