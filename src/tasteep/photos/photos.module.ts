import { Module } from '@nestjs/common';
import { PhotoStorageService } from './photo-storage.service';
import { PhotosController } from './photos.controller';

/** Photo files and their public, signed-URL route. Uploads live on the tasting. */
@Module({
  providers: [PhotoStorageService],
  controllers: [PhotosController],
  exports: [PhotoStorageService],
})
export class PhotosModule {}
