import '../env'; // must run first: typeormOptions() reads process.env

import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { typeormOptions } from './typeorm-options';

/**
 * Data source for the TypeORM CLI only (`npm run migration:*`), run from
 * `dist/` after a build. The app itself connects through `TypeOrmModule` in
 * `app.module.ts` with the same options and `autoLoadEntities`; here the
 * entities are found by file name instead, which is the same set as long as
 * every entity is registered by its feature module.
 */
export default new DataSource({
  ...typeormOptions(),
  entities: [join(__dirname, '..', '**', '*.entity.js')],
});
