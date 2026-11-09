import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

export const SMWS_PAGE_KINDS = ['bottle', 'other', 'gone'] as const;
/**
 * - `bottle` — a product with an ABV, stored in `tasteep_smws_catalog`
 * - `other`  — a product page without an ABV (gift card, glassware, pack…)
 * - `gone`   — the page answered 404
 */
export type SmwsPageKind = (typeof SMWS_PAGE_KINDS)[number];

/**
 * Every product URL from the smws.eu sitemap that has been read once, so
 * discovery only fetches URLs it has never seen. A failed read is not
 * recorded: the URL stays unknown and is retried on the next run.
 */
@Entity('tasteep_smws_pages')
@Index('tasteep_smws_pages_sku_idx', ['sku'])
export class TasteepSmwsPage {
  /** Normalized product URL. */
  @PrimaryColumn({ type: 'text' })
  url: string;

  @Column({ type: 'text' })
  kind: SmwsPageKind;

  /** The bottle's SKU when `kind` is `bottle`. */
  @Column({ type: 'text', nullable: true })
  sku: string | null;

  @Column({ name: 'first_read_at', type: 'timestamptz' })
  firstReadAt: Date;

  @Column({ name: 'last_read_at', type: 'timestamptz' })
  lastReadAt: Date;
}
