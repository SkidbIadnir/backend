import { TasteepUser } from '../entities/tasteep-user.entity';
import { TasteepSession } from '../entities/tasteep-session.entity';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import { TasteepRegion } from '../entities/tasteep-region.entity';
import { TasteepDistilleryLocation } from '../entities/tasteep-distillery-location.entity';
import { TasteepWishlistFolder } from '../entities/tasteep-wishlist-folder.entity';
import { TasteepWishlistItem } from '../entities/tasteep-wishlist-item.entity';
import { UpsertTastingDto } from '../tastings/dto/upsert-tasting.dto';
import { UpsertWishlistFolderDto } from '../wishlist/dto/upsert-wishlist-folder.dto';
import { UpsertWishlistItemDto } from '../wishlist/dto/upsert-wishlist-item.dto';

export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
export const TASTING_ID = '33333333-3333-4333-8333-333333333333';
export const SESSION_ID = '44444444-4444-4444-8444-444444444444';
export const WISHLIST_FOLDER_ID = '55555555-5555-4555-8555-555555555555';
export const WISHLIST_ITEM_ID = '66666666-6666-4666-8666-666666666666';

export const makeTasteepUser = (
  overrides: Partial<TasteepUser> = {},
): TasteepUser => ({
  id: USER_ID,
  email: 'nina@example.com',
  displayName: 'nina',
  provider: 'email',
  providerId: 'nina@example.com',
  themeMode: 'light',
  scoreScale: 'hundred',
  unitSystem: 'metric',
  currency: '£',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

export const makeSession = (
  overrides: Partial<TasteepSession> = {},
): TasteepSession => ({
  id: SESSION_ID,
  user: undefined as unknown as TasteepUser,
  userId: USER_ID,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: new Date('2027-01-01T00:00:00Z'),
  revokedAt: null,
  lastSeenAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

export const makeTasting = (
  overrides: Partial<TasteepTasting> = {},
): TasteepTasting => ({
  id: TASTING_ID,
  user: undefined as unknown as TasteepUser,
  userId: USER_ID,
  name: 'Lagavulin 16',
  category: 'whisky',
  photoPath: null,
  photoId: null,
  distillery: 'Lagavulin',
  region: 'Islay',
  regionRef: null,
  regionId: null,
  smwsBottle: null,
  smwsSku: null,
  abv: 43,
  price: 65.5,
  ageStatement: '16',
  caskType: 'Ex-bourbon & sherry',
  dateTasted: new Date('2026-03-10T19:00:00Z'),
  location: 'Home',
  score: 88,
  appearance: 'Deep amber',
  tags: ['peat', 'smoke'],
  nose: 'Bonfire',
  palate: 'Iodine',
  finish: 'Long',
  lat: null,
  lon: null,
  locationPrecision: 'unknown',
  createdAt: new Date('2026-03-10T20:00:00Z'),
  updatedAt: new Date('2026-03-10T20:00:00Z'),
  ...overrides,
});

export const makeUpsertDto = (
  overrides: Partial<UpsertTastingDto> = {},
): UpsertTastingDto => ({
  name: 'Lagavulin 16',
  category: 'whisky',
  photo_path: null,
  distillery: 'Lagavulin',
  region: 'Islay',
  region_id: null,
  abv: 43,
  price: 65.5,
  age_statement: '16',
  cask_type: 'Ex-bourbon & sherry',
  date_tasted: '2026-03-10T19:00:00.000Z',
  location: 'Home',
  score: 88,
  appearance: 'Deep amber',
  tags: ['peat', 'smoke'],
  nose: 'Bonfire',
  palate: 'Iodine',
  finish: 'Long',
  lat: null,
  lon: null,
  location_precision: 'unknown',
  ...overrides,
});

export const makeRegion = (
  overrides: Partial<TasteepRegion> = {},
): TasteepRegion => ({
  id: 'scotland/islay',
  name: 'Islay',
  parent: null,
  parentId: 'scotland',
  lat: 55.78,
  lon: -6.25,
  sortOrder: 1,
  aliases: [],
  deletedAt: null,
  ...overrides,
});

/** A three-row slice of the real seed: one country with two subregions plus a childless country. */
export const makeRegionRows = (): TasteepRegion[] => [
  makeRegion({
    id: 'scotland',
    name: 'Scotland',
    parentId: null,
    lat: 56.49,
    lon: -4.2,
    sortOrder: 0,
  }),
  makeRegion({
    id: 'scotland/speyside',
    name: 'Speyside',
    lat: 57.45,
    lon: -3.15,
    sortOrder: 0,
  }),
  makeRegion(),
  makeRegion({
    id: 'sweden',
    name: 'Sweden',
    parentId: null,
    lat: 62,
    lon: 15,
    sortOrder: 1,
  }),
];

export const makeWishlistFolder = (
  overrides: Partial<TasteepWishlistFolder> = {},
): TasteepWishlistFolder => ({
  id: WISHLIST_FOLDER_ID,
  user: undefined as unknown as TasteepUser,
  userId: USER_ID,
  name: 'Next Purchase',
  sortOrder: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

export const makeWishlistItem = (
  overrides: Partial<TasteepWishlistItem> = {},
): TasteepWishlistItem => ({
  id: WISHLIST_ITEM_ID,
  user: undefined as unknown as TasteepUser,
  userId: USER_ID,
  folder: null,
  folderId: WISHLIST_FOLDER_ID,
  name: 'Springbank 15',
  distillery: 'Springbank',
  region: 'Campbeltown',
  regionRef: null,
  regionId: null,
  category: 'whisky',
  targetPrice: 98,
  whyIWant:
    'Tasted a dram of the 12 at the Society bar — the 15 is meant to carry the same oily body with more sherry.',
  whereToBuy: 'Royal Mile Whiskies, Edinburgh',
  fulfilledTasting: null,
  fulfilledTastingId: null,
  createdAt: new Date('2026-01-02T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  ...overrides,
});

export const makeUpsertFolderDto = (
  overrides: Partial<UpsertWishlistFolderDto> = {},
): UpsertWishlistFolderDto => ({
  name: 'Next Purchase',
  sort_order: 0,
  ...overrides,
});

export const makeUpsertItemDto = (
  overrides: Partial<UpsertWishlistItemDto> = {},
): UpsertWishlistItemDto => ({
  name: 'Springbank 15',
  folder_id: WISHLIST_FOLDER_ID,
  distillery: 'Springbank',
  region: 'Campbeltown',
  region_id: null,
  category: 'whisky',
  target_price: 98,
  why_i_want:
    'Tasted a dram of the 12 at the Society bar — the 15 is meant to carry the same oily body with more sherry.',
  where_to_buy: 'Royal Mile Whiskies, Edinburgh',
  fulfilled_tasting_id: null,
  ...overrides,
});

export const makeDistilleryLocation = (
  overrides: Partial<TasteepDistilleryLocation> = {},
): TasteepDistilleryLocation => ({
  id: 'ardbeg',
  name: 'Ardbeg',
  lat: 55.6418579,
  lon: -6.1111707,
  precision: 'exact',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  deletedAt: null,
  ...overrides,
});
