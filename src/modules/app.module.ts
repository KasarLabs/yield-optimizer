import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from '../controllers/app.controller.js';
import { AppService } from '../services/app.service.js';
import { McpAgentService } from '../services/mcp-agent.service.js';
import { CacheService } from '../services/cache/cache.service.js';
import { PromptBuilderService } from '../services/prompt/prompt-builder.service.js';
import { TokenResolverService } from '../services/token/token-resolver.service.js';
import { ApiSecretGuard } from '../guards/api-secret.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        // General rate limiter for all endpoints
        ttl: 15 * 60 * 1000, // 15 minutes
        limit: 150, // 100 requests per 15 minutes
      },
    ]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    McpAgentService,
    CacheService,
    PromptBuilderService,
    TokenResolverService,
    ApiSecretGuard,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
