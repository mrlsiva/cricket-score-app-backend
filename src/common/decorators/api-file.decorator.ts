import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { MAX_VIDEO_BYTES } from '../../infrastructure/storage/storage.service';

/** Multipart single-file upload (`file` field) + Swagger schema. Content is validated by StorageService. */
export function ApiFile(extra: Record<string, { type: string; description?: string }> = {}, maxBytes = MAX_VIDEO_BYTES) {
  return applyDecorators(
    UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: maxBytes, files: 1 } })),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['file'],
        properties: { file: { type: 'string', format: 'binary' }, ...extra },
      },
    }),
  );
}
