import { applyUpsertDto, toTastingJson } from './tasting.mapper';
import {
  makeTasting,
  makeUpsertDto,
  TASTING_ID,
  USER_ID,
} from '../test-utils/fixtures';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';

describe('tasting.mapper', () => {
  describe('toTastingJson', () => {
    it('emits the exact snake_case contract of lib/models/tasting.dart', () => {
      const json = toTastingJson(makeTasting());
      expect(Object.keys(json).sort()).toEqual(
        [
          'id',
          'name',
          'category',
          'photo_path',
          'distillery',
          'region',
          'abv',
          'price',
          'age_statement',
          'cask_type',
          'date_tasted',
          'location',
          'score',
          'appearance',
          'tags',
          'nose',
          'palate',
          'finish',
          'lat',
          'lon',
          'location_precision',
          'created_at',
          'updated_at',
        ].sort(),
      );
      expect(json.date_tasted).toBe('2026-03-10T19:00:00.000Z');
      expect(json.created_at).toBe('2026-03-10T20:00:00.000Z');
      expect(json.age_statement).toBe('16');
      expect(json.tags).toEqual(['peat', 'smoke']);
    });

    it('turns undefined optional fields into null and missing tags into []', () => {
      const bare = {
        id: TASTING_ID,
        userId: USER_ID,
        name: 'x',
        category: 'rum',
      } as TasteepTasting;
      const json = toTastingJson(bare);
      expect(json.photo_path).toBeNull();
      expect(json.date_tasted).toBeNull();
      expect(json.tags).toEqual([]);
      expect(json.location_precision).toBe('unknown');
      expect(json.created_at).toBeNull();
    });
  });

  describe('applyUpsertDto', () => {
    it('copies every field, parsing date_tasted into a Date', () => {
      const t = applyUpsertDto(
        { id: TASTING_ID, userId: USER_ID } as TasteepTasting,
        makeUpsertDto(),
      );
      expect(t.name).toBe('Lagavulin 16');
      expect(t.ageStatement).toBe('16');
      expect(t.caskType).toBe('Ex-bourbon & sherry');
      expect(t.dateTasted).toEqual(new Date('2026-03-10T19:00:00.000Z'));
      expect(t.locationPrecision).toBe('unknown');
    });

    it('is a full replacement: absent keys become null and defaults apply', () => {
      const existing = makeTasting({
        score: 90,
        tags: ['a'],
        lat: 1,
        lon: 2,
        locationPrecision: 'exact',
      });
      const t = applyUpsertDto(existing, { name: 'Only a name' });
      expect(t.score).toBeNull();
      expect(t.distillery).toBeNull();
      expect(t.dateTasted).toBeNull();
      expect(t.tags).toEqual([]);
      expect(t.category).toBe('whisky');
      expect(t.locationPrecision).toBe('unknown');
      expect(t.lat).toBeNull();
    });
  });
});
