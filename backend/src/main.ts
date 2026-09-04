import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { DefaultAdminSeed } from './common/seed/default-admin.seed';

// Exported for unit testing: seed failures (e.g. DB not migrated yet) must not block app startup.
export async function runSeedSafely(seedService: DefaultAdminSeed) {
  try {
    await seedService.run();
  } catch (error) {
    console.error('Default admin seed failed, continuing startup:', error);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new RequestLoggingInterceptor());

  const seedService = app.get(DefaultAdminSeed);
  await runSeedSafely(seedService);

  await app.listen(process.env.PORT ?? 3000);
}

// Avoid auto-running bootstrap when this module is imported (e.g. in tests).
if (require.main === module) {
  bootstrap();
}
