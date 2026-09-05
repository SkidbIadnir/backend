import './env'; // must run before AppModule is required — see src/env.ts

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : false,
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  // Bind all interfaces, not just IPv6 loopback (::1) — under WSL2, Nest's
  // default bind means only the Windows host can reach it via 'localhost';
  // an Android emulator's 10.0.2.2 alias forwards IPv4 only and gets refused.
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
