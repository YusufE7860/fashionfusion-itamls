import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client as MinioClient } from 'minio';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  // Internal client — reaches MinIO over the Docker network (http://minio:9000).
  // Used for ALL server-side operations (put/get/delete).
  private client: MinioClient;
  // Public client — generates presigned URLs that the BROWSER can hit directly.
  // Configured with the public hostname + TLS and an EXPLICIT region so it
  // doesn't try to detect it over the network (which would trigger a NAT
  // hairpin call to the public IP from inside Docker and time out).
  private publicClient: MinioClient;
  readonly bucket: string;

  constructor() {
    const accessKey = process.env.MINIO_ACCESS_KEY ?? 'minioadmin';
    const secretKey = process.env.MINIO_SECRET_KEY ?? 'minioadmin';
    const region    = process.env.MINIO_REGION ?? 'us-east-1';

    this.client = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: Number(process.env.MINIO_PORT ?? 9000),
      useSSL: (process.env.MINIO_USE_SSL ?? 'false') === 'true',
      accessKey, secretKey, region,
    });

    this.publicClient = new MinioClient({
      endPoint: process.env.MINIO_PUBLIC_ENDPOINT ?? process.env.MINIO_ENDPOINT ?? 'localhost',
      port: Number(process.env.MINIO_PUBLIC_PORT ?? process.env.MINIO_PORT ?? 9000),
      useSSL: (process.env.MINIO_PUBLIC_USE_SSL ?? process.env.MINIO_USE_SSL ?? 'false') === 'true',
      accessKey, secretKey, region,
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
    return this.publicClient.presignedGetObject(this.bucket, key, expirySeconds);
  }

  async presignedPut(key: string, expirySeconds = 60 * 60) {
    return this.publicClient.presignedPutObject(this.bucket, key, expirySeconds);
  }

  async remove(key: string) {
    await this.client.removeObject(this.bucket, key);
  }

  /** Put a Readable stream to MinIO (used for backup uploads streamed through the API). */
  async putStream(key: string, stream: Readable, size: number, contentType = 'application/zip') {
    await this.client.putObject(this.bucket, key, stream, size, { 'Content-Type': contentType });
    return key;
  }
}
