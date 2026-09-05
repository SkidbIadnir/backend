import { Repository } from 'typeorm';

export type MockRepository<T extends object = any> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

/**
 * Jest stand-in for a TypeORM repository. `create` returns its input so
 * services that do `repo.save(repo.create({...}))` see the object they built.
 */
export const createMockRepository = <
  T extends object = any,
>(): MockRepository<T> => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findBy: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  count: jest.fn(),
  upsert: jest.fn(),
  create: jest.fn((input: unknown) => input),
  createQueryBuilder: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  }),
});

/** Chainable query-builder mock whose terminal calls resolve to the given raw rows. */
export const createMockQueryBuilder = (
  rawOne: unknown = undefined,
  rawMany: unknown[] = [],
) => {
  const qb: Record<string, jest.Mock> = {};
  for (const m of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'groupBy',
    'orderBy',
    'addOrderBy',
  ]) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawOne = jest.fn().mockResolvedValue(rawOne);
  qb.getRawMany = jest.fn().mockResolvedValue(rawMany);
  return qb;
};
