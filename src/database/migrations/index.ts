import type { MixedList } from 'typeorm';
import { Baseline1795529563637 } from './1795529563637-Baseline';

/**
 * Every migration, oldest first. Listed by hand (not globbed) so they load the
 * same way from `dist/`, under ts-jest and in the Docker image. After
 * `npm run migration:generate -- src/database/migrations/<Name>`, import the
 * new class here and append it.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const MIGRATIONS: MixedList<Function> = [Baseline1795529563637];
