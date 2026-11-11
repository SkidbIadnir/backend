import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { TasteepRegion } from '../entities/tasteep-region.entity';
import { TasteepSmwsCode } from '../entities/tasteep-smws-code.entity';
import { TasteepTasting } from '../entities/tasteep-tasting.entity';
import { buildSmwsMe, SmwsMeJson } from './smws-me';

/** The user's SMWS progress (`GET /tasteep/smws/me`). */
@Injectable()
export class SmwsMeService {
  constructor(
    @InjectRepository(TasteepTasting)
    private readonly tastings: Repository<TasteepTasting>,
    @InjectRepository(TasteepSmwsCode)
    private readonly codes: Repository<TasteepSmwsCode>,
    @InjectRepository(TasteepRegion)
    private readonly regions: Repository<TasteepRegion>,
  ) {}

  async forUser(userId: string): Promise<SmwsMeJson> {
    const [tastings, codes, regions] = await Promise.all([
      this.tastings.find({
        where: { userId, smwsSku: Not(IsNull()) },
        relations: { smwsBottle: { smwsCode: true } },
      }),
      this.codes.find({
        select: { code: true, category: true, regionId: true },
        order: { sortOrder: 'ASC', code: 'ASC' },
      }),
      this.regions.find({ select: { id: true, name: true } }),
    ]);
    return buildSmwsMe(
      tastings,
      codes,
      new Map(regions.map((r) => [r.id, r.name])),
    );
  }
}
