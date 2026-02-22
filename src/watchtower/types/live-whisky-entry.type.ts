export interface LiveWhiskyEntry {
  id: number;
  name: string;
  fullCode: string;
  distilleryCode: string | null;
  caskNo: string | null;
  price: string | null;
  profile: string | null;
  abv: string | null;
  age: string | null;
  caskType: string | null;
  distillery: string | null;
  region: string | null;
  available: boolean;
  url: string | null;
  isNew: boolean;
  newSince: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
