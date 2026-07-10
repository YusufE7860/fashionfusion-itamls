import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client as MinioClient } from 'minio';
import { randomBytes } from 'node:crypto';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client: MinioClient;
  readonly bucket: string;

  constructor() {
    this.client = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: Number(process.env.MINIO_PORT ?? 9000),
      useSSL: (process.env.MINIO_USE_SSL ?? 'false') === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    });
    this.bucket = process.env.MINIO_BUCKET ?? 'itamls-invoices';
  }

  async onModuleInit() {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket, 'us-east-1');
        this.logger.log(`Created MinIO bucket: ${this.bucket}`);
      }
    } catch (e: any) {
      this.logger.warn(`MinIO not reachable on startup: ${e.message}. Uploads will fail until MinIO is up.`);
    }
  }

  generateObjectKey(originalName: string, prefix = 'invoices') {
    const ext = originalName.includes('.') ? originalName.split('.').pop() : 'bin';
    const id = randomBytes(8).toString('hex');
    const date = new Date().toISOString().slice(0, 10);
    return `${prefix}/${date}/${id}.${ext}`;
  }

  async putObject(key: string, body: Buffer, contentType: string) {
    await this.client.putObject(this.bucket, key, body, body.length, { 'Content-Type': contentType });
    return key;
  }

  async getStream(key: string) {
    return this.client.getObject(this.bucket, key);
  }

  async presignedGet(key: string, expirySeconds = 60 * 60) {
    return this.client.presignedGetObject(this.bucket, key, expirySeconds);
  }

  async presignedPut(key: string, expirySeconds = 60 * 60) {
    return this.client.presignedPutObject(this.bucket, key, expirySeconds);
  }

  async remove(key: string) {
    await this.client.removeObject(this.bucket, key);
  }

  /** Put a Readable stream to MinIO (used for backup uploads streamed through the API). */
  async putStream(key: string, stream: NodeJS.ReadableStream, size: number, contentType = 'application/zip') {
    await this.client.putObject(this.bucket, key, stream, size, { 'Content-Type': contentType });
    return key;
  }
}
