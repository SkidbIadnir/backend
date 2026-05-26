import { SmwsLive } from '../entities/smws-live.entity';
import { UserAlert } from '../entities/user-alert.entity';
import { SmwsDistillery } from '../entities/smws-distillery.entity';
import { ScrapedWhiskyData } from '../scraper/scraper.service';

export const makeUserAlert = (overrides: Partial<UserAlert> = {}): UserAlert => ({
  id: 1,
  userId: 'user-123',
  guildId: 'guild-456',
  alertType: 'distillery',
  alertValue: 'Glenfarclas',
  name: null,
  isActive: true,
  createdAt: new Date('2024-01-01'),
  ...overrides,
});

export const makeSmwsLive = (overrides: Partial<SmwsLive> = {}): SmwsLive => ({
  id: 1,
  name: 'Distillery G1, Cask 1.100 — A dram to remember',
  fullCode: '1.100',
  distilleryCode: '1',
  caskNo: '100',
  price: '£85.00',
  abv: '58.2%',
  age: '12 years',
  caskType: 'First Fill Bourbon Barrel',
  profile: 'Fruity & Spicy',
  distillery: 'Glenfarclas',
  region: 'Speyside',
  available: true,
  url: 'https://smws.eu/product/1.100',
  isNew: true,
  newSince: new Date('2024-01-01'),
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

export const makeScrapedWhisky = (overrides: Partial<ScrapedWhiskyData> = {}): ScrapedWhiskyData => ({
  name: 'Distillery G1, Cask 1.100 — A dram to remember',
  fullCode: '1.100',
  distilleryId: 1,
  caskNo: '100',
  price: '£85.00',
  abv: '58.2%',
  age: '12 years',
  caskType: 'First Fill Bourbon Barrel',
  profile: 'Fruity & Spicy',
  distillery: 'Glenfarclas',
  region: 'Speyside',
  available: true,
  url: 'https://smws.eu/product/1.100',
  ...overrides,
});

export const makeSmwsDistillery = (overrides: Partial<SmwsDistillery> = {}): SmwsDistillery => ({
  id: 1,
  smwsId: '1',
  distilleryName: 'Glenfarclas',
  region: 'Speyside',
  category: 'Single Malt Scotch',
  extraInfo: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});
