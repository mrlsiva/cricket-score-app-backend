import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

export type UploadKind = 'player-photo' | 'team-logo' | 'tournament-logo' | 'tournament-banner' | 'gallery';

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp'];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/3gpp': '3gp',
};

export interface StoredFile {
  url: string;
  key: string;
  mimeType: string;
  size: number;
  mediaType: 'PHOTO' | 'VIDEO';
}

/** Detects the real type from magic bytes (never trust client-supplied mimetype). */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (brand === 'qt  ') return 'video/quicktime';
    if (brand.startsWith('3g')) return 'video/3gpp';
    return 'video/mp4';
  }
  return null;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: 'local' | 's3';
  private readonly uploadDir: string;
  private readonly s3?: S3Client;

  constructor(private readonly config: ConfigService) {
    this.driver = config.get('storage.driver')!;
    this.uploadDir = path.resolve(config.get<string>('storage.uploadDir')!);
    if (this.driver === 's3') {
      const s3 = config.get('storage.s3');
      this.s3 = new S3Client({
        region: s3.region,
        endpoint: s3.endpoint,
        forcePathStyle: s3.forcePathStyle,
        credentials: s3.accessKeyId ? { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey } : undefined,
      });
    }
  }

  get localDir() {
    return this.uploadDir;
  }

  /** Validates and stores an uploaded file. Videos only allowed for gallery uploads. */
  async save(file: Express.Multer.File | undefined, kind: UploadKind): Promise<StoredFile> {
    if (!file?.buffer?.length) throw new BadRequestException('File is required');
    const mime = sniffMime(file.buffer);
    const allowVideo = kind === 'gallery';
    const isImage = !!mime && IMAGE_MIMES.includes(mime);
    const isVideo = !!mime && VIDEO_MIMES.includes(mime);
    if (!isImage && !(allowVideo && isVideo)) {
      throw new BadRequestException(
        allowVideo ? 'Only JPEG, PNG, WEBP, GIF images or MP4/MOV/WEBM/3GP videos are allowed' : 'Only JPEG, PNG, WEBP or GIF images are allowed',
      );
    }
    if (isImage && file.size > MAX_IMAGE_BYTES) throw new BadRequestException('Image exceeds 10 MB');
    if (isVideo && file.size > MAX_VIDEO_BYTES) throw new BadRequestException('Video exceeds 100 MB');

    const now = new Date();
    const key = `${kind}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${EXT[mime!]}`;
    const url = await this.put(key, file.buffer, mime!);
    return { url, key, mimeType: mime!, size: file.size, mediaType: isVideo ? 'VIDEO' : 'PHOTO' };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    if (this.driver === 's3') {
      const bucket = this.config.get<string>('storage.s3.bucket')!;
      await this.s3!.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
      const publicUrl = this.config.get<string>('storage.s3.publicUrl');
      return publicUrl ? `${publicUrl.replace(/\/$/, '')}/${key}` : `https://${bucket}.s3.amazonaws.com/${key}`;
    }
    const target = path.join(this.uploadDir, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
    return `${this.config.get<string>('appUrl')}/uploads/${key}`;
  }

  async remove(key: string): Promise<void> {
    try {
      if (this.driver === 's3') {
        await this.s3!.send(new DeleteObjectCommand({ Bucket: this.config.get('storage.s3.bucket'), Key: key }));
      } else {
        const target = path.join(this.uploadDir, key);
        if (target.startsWith(this.uploadDir)) await fs.unlink(target);
      }
    } catch (e: any) {
      this.logger.warn(`Failed to delete ${key}: ${e.message}`);
    }
  }
}
