import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './modules/app.module.js';

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
  configureLangSmithEnvironment(app.get(ConfigService));
  const port = process.env.PORT || 3042;
  await app.listen(port);
}
bootstrap();
