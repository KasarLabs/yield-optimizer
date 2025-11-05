import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from '../controllers/app.controller.js';
import { AppService } from '../services/app.service.js';
import { McpAgentService } from '../services/mcp-agent.service.js';
import { CacheService } from '../services/cache/cache.service.js';
import { PromptBuilderService } from '../services/prompt/prompt-builder.service.js';
import { TokenResolverService } from '../services/token/token-resolver.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    McpAgentService,
    CacheService,
    PromptBuilderService,
    TokenResolverService,
  ],
})
export class AppModule {}
