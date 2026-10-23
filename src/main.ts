import './env'; // must run before AppModule is required — see src/env.ts

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AdminModule } from './admin/admin.module';
import { AdminLogger } from './admin/logging/admin-logger';
import { logBuffer } from './admin/logging/log-buffer';
import { AppModule } from './app.module';

async function bootstrap() {
  // Buffer startup logs until the ring-buffer logger is installed, so /admin/logs sees them too.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new AdminLogger(logBuffer));
  app.enableCors({
    origin: process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',')
      : false,
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  // Machine-readable contract for the dashboard's generated client (JSON only, no UI).
  const adminDoc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Admin API')
      .setVersion('1')
      .addBearerAuth()
      .build(),
    { include: [AdminModule] },
  );
  SwaggerModule.setup('admin/docs', app, adminDoc, {
    ui: false,
    jsonDocumentUrl: 'admin/openapi.json',
  });
  // Bind all interfaces, not just IPv6 loopback (::1) — under WSL2, Nest's
  // default bind means only the Windows host can reach it via 'localhost';
  // an Android emulator's 10.0.2.2 alias forwards IPv4 only and gets refused.
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
