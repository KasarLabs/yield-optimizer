import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './modules/app.module.js';
import helmet from 'helmet';
import * as express from 'express';

const bootstrapLogger = new Logger('Bootstrap');

function configureLangSmithEnvironment(configService: ConfigService): void {
  const langsmithEnabled =
    configService.get<string>('LANGSMITH_ENABLED') === 'true' ||
    configService.get<string>('LANGCHAIN_TRACING_V2') === 'true';

  if (!langsmithEnabled) {
    return;
  }

  const langsmithApiKey =
    configService.get<string>('LANGSMITH_API_KEY') ??
    configService.get<string>('LANGCHAIN_API_KEY');

  const langsmithProject =
    configService.get<string>('LANGSMITH_PROJECT') ??
    configService.get<string>('LANGCHAIN_PROJECT') ??
    'yield-optimizer';

  if (!langsmithApiKey) {
    bootstrapLogger.warn(
      'LangSmith is enabled but API key is missing. Set LANGSMITH_API_KEY or LANGCHAIN_API_KEY to enable tracing.',
    );
    return;
  }

  process.env.LANGCHAIN_API_KEY = langsmithApiKey;
  process.env.LANGCHAIN_TRACING_V2 = 'true';
  process.env.LANGCHAIN_PROJECT = langsmithProject;
  process.env.LANGSMITH_API_KEY = langsmithApiKey;
  process.env.LANGSMITH_PROJECT = langsmithProject;
  process.env.LANGSMITH_TRACING = 'true';

  bootstrapLogger.log(
    `LangSmith tracing enabled for project: ${langsmithProject}`,
  );
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  configureLangSmithEnvironment(configService);

  const isDevelopment =
    process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

  // Security headers with Helmet
  app.use(
    helmet({
      contentSecurityPolicy: isDevelopment ? false : undefined,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // CORS configuration
  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',') : '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-API-Secret',
    ],
  });

  // Body size limit (1MB) - configured via Express adapter
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(express.json({ limit: '1mb' }));
  expressApp.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = configService.get<number>('PORT') || 3042;
  await app.listen(port);
  bootstrapLogger.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
