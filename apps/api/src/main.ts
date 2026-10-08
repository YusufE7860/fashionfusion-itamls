import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { RmmGateway } from './rmm/rmm.gateway';

// Prisma returns BigInt for BigInt columns; JSON.stringify throws on BigInt
// by default. Teach it to render as a plain number string so responses work.
(BigInt.prototype as any).toJSON = function () {
  const n = Number(this);
  return Number.isSafeInteger(n) ? n : this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','),
    credentials: true,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);

  // Attach the RMM WebSocket gateway to the same HTTP server. This exposes
  // wss://.../api/v1/rmm/ws for PC agents to connect to.
  const httpServer = app.getHttpServer();
  const rmm = app.get(RmmGateway);
  rmm.attach(httpServer);

  // eslint-disable-next-line no-console
  console.log(`ITAMLS API listening on http://localhost:${port}/api/v1  (RMM ws at /api/v1/rmm/ws)`);
}
bootstrap();
