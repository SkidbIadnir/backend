import { TasteepUser } from '../entities/tasteep-user.entity';
import { TasteepSession } from '../entities/tasteep-session.entity';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import { UpsertTastingDto } from '../tastings/dto/upsert-tasting.dto';

export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
export const TASTING_ID = '33333333-3333-4333-8333-333333333333';
export const SESSION_ID = '44444444-4444-4444-8444-444444444444';

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
  distillery: 'Lagavulin',
  region: 'Islay',
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
