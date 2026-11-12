import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tasteepConfig } from '../tasteep-config';
import type { ProcessedPhoto } from './photo-processor';
import type { PhotoSize } from './photo-url';

/**
 * Processed photos on local disk, keyed by a server-generated UUID:
 * `<root>/<first two hex chars>/<id>.webp` and `<id>.thumb.webp`.
 *
 * The only place that knows where files live, so moving to object storage
 * later means replacing this class and nothing else.
 */
@Injectable()
export class PhotoStorageService {
  private readonly logger = new Logger(PhotoStorageService.name);

  /** Overridable in tests; resolved at call time so env changes apply. */
  root(): string {
    return resolve(tasteepConfig.photosDir);
  }

  /** Absolute path of one size of a photo. `photoId` must be a validated UUID. */
  path(photoId: string, size: PhotoSize): string {
    const name = size === 'full' ? `${photoId}.webp` : `${photoId}.thumb.webp`;
    return join(this.root(), photoId.slice(0, 2), name);
  }

  /** Writes both sizes; each file appears atomically (temp file + rename). */
  async save(photoId: string, photo: ProcessedPhoto): Promise<void> {
    await mkdir(join(this.root(), photoId.slice(0, 2)), { recursive: true });
    try {
      await this.write(this.path(photoId, 'full'), photo.full);
      await this.write(this.path(photoId, 'thumb'), photo.thumb);
    } catch (err) {
      await this.remove(photoId);
      throw err;
    }
  }

  async exists(photoId: string, size: PhotoSize): Promise<boolean> {
    try {
      return (await stat(this.path(photoId, size))).isFile();
    } catch {
      return false;
    }
  }

  /** Best-effort: a file that cannot be deleted is logged, never thrown. */
  async remove(photoId: string): Promise<void> {
    for (const size of ['full', 'thumb'] as const) {
      try {
        await rm(this.path(photoId, size), { force: true });
      } catch (err) {
        this.logger.warn(
          `Could not delete ${size} photo ${photoId}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async write(target: string, data: Buffer): Promise<void> {
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, data);
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }
}
