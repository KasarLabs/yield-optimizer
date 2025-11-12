import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import 'langsmith';

import type { ToolDef } from '../mcp/askStarknetClient.js';
import { loadAllowedTools } from '../mcp/capabilityLoader.js';
import { OutputSchema } from '../schemas/output.js';
import { StdioAskStarknetAdapter } from './client/mcp-client.adapter.js';
import { CacheService } from './cache/cache.service.js';
import { AgentConversationService } from './agent/agent-conversation.service.js';
import { PromptBuilderService } from './prompt/prompt-builder.service.js';
import { TokenResolverService } from './token/token-resolver.service.js';
import { AgentUtils } from './utils/agent.utils.js';
import type {
  AskClient,
  AgentOutput,
  YieldToken,
} from './types/agent.types.js';

export type { AgentOutput } from './types/agent.types.js';

const MAX_ITERATIONS = 12;

@Injectable()
export class McpAgentService implements OnModuleDestroy {
  private readonly logger = new Logger(McpAgentService.name);
  private readonly anthropic: Anthropic;
  private readonly model: string;
  private askClient: AskClient | null = null;
  private askClientCleanup: (() => Promise<void>) | null = null;
  private readonly agentConversation: AgentConversationService;

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly tokenResolver: TokenResolverService,
  ) {
    const apiKey =
      this.configService.get<string>('ANTHROPIC_API_KEY') ??
      this.configService.get<string>('MODEL_API_KEY');

    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY or MODEL_API_KEY must be configured');
    }

    this.model =
      this.configService.get<string>('MODEL_NAME') ??
      'claude-3-5-sonnet-20241022';
    this.anthropic = new Anthropic({ apiKey });
    this.agentConversation = new AgentConversationService(
      this.anthropic,
      this.model,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeAskClient();
  }

  async findBestYieldPath(
    inputTokenAddress: string,
    amount: string,
  ): Promise<AgentOutput> {
    const errors: string[] = [];

    // ========== PHASE 1: Check Yield Cache ==========
    const cachedYield = this.cacheService.getCachedYield();
    let yieldData = cachedYield;
    let yieldFingerprint: string | null = null;

    // If we have a cached yield, check if we also have a cached route
    if (cachedYield) {
      const cacheAgeMinutes = this.cacheService.getYieldCacheAge() ?? 0;
      this.logger.log(
        `Using cached yield (cache age: ${cacheAgeMinutes} minutes) - skipping yield.agent.prompt`,
      );

      yieldFingerprint = this.cacheService.computeYieldFingerprint(cachedYield);
      const cachedRoute = this.cacheService.getCachedRoute(
        inputTokenAddress,
        amount,
        yieldFingerprint,
      );

      if (cachedRoute) {
        const routeCacheAgeMinutes = Math.round(
          (Date.now() - cachedRoute.timestamp) / 1000 / 60,
        );
        this.logger.log(
          `Using cached route for token: ${inputTokenAddress} (cache age: ${routeCacheAgeMinutes} minutes) - skipping route.agent.prompt`,
        );

        return this.buildFinalResponse(cachedYield, cachedRoute.routes, [
          ...errors,
          ...(cachedRoute.errors ?? []),
        ]);
      }

      // We have cached yield but no cached route - we'll need to get routing only
      this.logger.log(
        `No cached route found for token: ${inputTokenAddress} and amount: ${amount} - will compute routing only`,
      );
    }

    // ========== PHASE 2: Initialize MCP Client ==========
    const askClient = await this.getAskClient();
    const allowedCapabilities = await loadAllowedTools(askClient);

    if (allowedCapabilities.length === 0) {
      const available = await askClient.listTools();
      const availableNames =
        available.map((tool) => tool.name).join(', ') || 'none';
      this.logger.error(
        `No ask-starknet tools available. Available from router: ${availableNames}`,
      );
      throw new Error(
        `No capabilities available. Available tools: ${availableNames}`,
      );
    }

    // ========== PHASE 3: Resolve Input Token Symbol ==========
    let resolvedInputSymbol =
      this.cacheService.getCachedTokenSymbol(inputTokenAddress);

    if (!resolvedInputSymbol) {
      const symbolLookup = await this.ensureTokenSymbol(
        inputTokenAddress,
        askClient,
        allowedCapabilities,
      );

      if (symbolLookup.errors.length > 0) {
        errors.push(...symbolLookup.errors);
      }

      if (symbolLookup.symbol) {
        resolvedInputSymbol = symbolLookup.symbol;
      }
    }

    // ========== PHASE 4: Yield Discovery (only if not cached) ==========
    if (!yieldData) {
      this.logger.log(`No cached yield found - executing yield.agent.prompt`);

      yieldData = await this.discoverYield(
        inputTokenAddress,
        askClient,
        allowedCapabilities,
      );

      if (yieldData) {
        this.cacheService.setCachedYield(yieldData);
        yieldFingerprint = this.cacheService.computeYieldFingerprint(yieldData);
      }
    }

    if (!yieldData) {
      throw new Error('Yield data is unavailable after discovery.');
    }

    // Ensure we have a yield fingerprint for cache lookup
    if (!yieldFingerprint) {
      yieldFingerprint = this.cacheService.computeYieldFingerprint(yieldData);
    }

    // ========== PHASE 5: Route Discovery ==========
    const { routes, routeErrors } = await this.discoverRoutes(
      inputTokenAddress,
      amount,
      yieldData,
      resolvedInputSymbol,
      askClient,
      allowedCapabilities,
    );

    errors.push(...routeErrors);

    const validated = this.buildFinalResponse(yieldData, routes, errors);

    // Extract and cache token symbols from the response
    this.cacheService.extractAndCacheTokenSymbols(validated);

    this.cacheService.setCachedRoute(
      inputTokenAddress,
      amount,
      yieldFingerprint,
      {
        routes: validated.routes,
        errors: validated.errors,
      },
    );

    return validated;
  }

  private buildFinalResponse(
    yieldData: AgentOutput['yield'],
    routes: AgentOutput['routes'],
    errors?: string[],
  ): AgentOutput {
    const finalPayload: Record<string, unknown> = {
      yield: yieldData,
      routes,
    };

    if (errors && errors.length > 0) {
      finalPayload.errors = errors;
    }

    return OutputSchema.parse(finalPayload);
  }

  private async discoverYield(
    inputTokenAddress: string,
    askClient: AskClient,
    allowedCapabilities: ToolDef[],
  ): Promise<AgentOutput['yield'] | null> {
    const yieldPrompt = await this.promptBuilder.buildYieldSystemPrompt();

    const yieldToolNames = new Set([
      'ask_starknet/troves_get_strategies',
      'ask_starknet/endurfi_get_lst_stats',
    ]);

    let yieldTools = allowedCapabilities.filter((tool) =>
      yieldToolNames.has(tool.name),
    );

    if (yieldTools.length === 0) {
      const routerTool = allowedCapabilities.find((tool) =>
        AgentUtils.isAskStarknetRouter(tool.name),
      );
      if (routerTool) {
        this.logger.warn(
          'Yield discovery tools not individually exposed; falling back to ask_starknet router tool.',
        );
        yieldTools = [routerTool];
      }
    }

    if (yieldTools.length === 0) {
      const availableToolNames =
        allowedCapabilities.map((t) => t.name).join(', ') || 'none';
      const allToolNames =
        (await askClient.listTools()).map((t) => t.name).join(', ') || 'none';
      this.logger.error(
        `Yield discovery tools not found. Allowed capabilities: ${availableToolNames}`,
      );
      throw new Error(
        `Yield discovery tools are unavailable. Available tools: ${allToolNames}`,
      );
    }

    const anthropicYieldTools = yieldTools.map((tool) =>
      this.agentConversation.toAnthropicTool(tool),
    );

    const yieldResponse = await this.agentConversation.runAgentConversation({
      systemPrompt: yieldPrompt,
      userContent: {
        inputToken: { address: inputTokenAddress },
      },
      tools: anthropicYieldTools,
      askClient,
      maxIterations: MAX_ITERATIONS,
    });

    const yieldResult = this.agentConversation.parseAgentOutput(yieldResponse);
    return yieldResult.yield;
  }

  private async discoverRoutes(
    inputTokenAddress: string,
    amount: string,
    yieldData: AgentOutput['yield'],
    resolvedInputSymbol: string | null,
    askClient: AskClient,
    allowedCapabilities: ToolDef[],
  ): Promise<{
    routes: AgentOutput['routes'];
    routeErrors: string[];
  }> {
    const routeErrors: string[] = [];

    const ekuboTools = allowedCapabilities.filter((tool) =>
      tool.name.startsWith('ask_starknet/ekubo'),
    );
    const avnuTools = allowedCapabilities.filter((tool) =>
      tool.name.startsWith('ask_starknet/avnu'),
    );
    const routerFallback = allowedCapabilities.find((tool) =>
      AgentUtils.isAskStarknetRouter(tool.name),
    );

    let routes: AgentOutput['routes'] = [];

    const hasRoutingOption =
      ekuboTools.length > 0 || avnuTools.length > 0 || Boolean(routerFallback);

    if (!hasRoutingOption) {
      this.logger.warn(
        'No routing tools available; returning yield data only.',
      );
      routeErrors.push('Routing skipped: no routing tools available.');
      return { routes: [], routeErrors };
    }

    const rawTargetTokens = yieldData.deposit_token;

    const targetTokensForRouting: YieldToken[] = [];

    for (const rawToken of rawTargetTokens) {
      const resolution = await this.tokenResolver.resolveSwapTokenSymbol(
        rawToken,
        (address) => this.cacheService.getCachedTokenSymbol(address),
        (address, symbol) =>
          this.cacheService.setCachedTokenSymbol(address, symbol),
        (tokenAddress, client, capabilities, maxIter) =>
          this.ensureTokenSymbol(tokenAddress, client, capabilities),
        askClient,
        allowedCapabilities,
        MAX_ITERATIONS,
      );

      if (resolution.errors.length > 0) {
        routeErrors.push(...resolution.errors);
      }

      targetTokensForRouting.push(resolution.token);
    }

    let amountSplits: string[] = [];
    try {
      amountSplits = AgentUtils.splitAmount(
        amount,
        targetTokensForRouting.length,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to split amount for routing.';
      this.logger.error(message, error instanceof Error ? error : undefined);
      routeErrors.push(`Routing skipped: ${message}`);
      return { routes: [], routeErrors };
    }

    const attemptRouteWithTools = async (
      tools: ToolDef[],
      label: string,
    ): Promise<{
      success: boolean;
      routes: AgentOutput['routes'];
      errors: string[];
    }> => {
      if (tools.length === 0) {
        this.logger.warn(
          `Routing attempt skipped for ${label}: no tools available.`,
        );
        return {
          success: false,
          routes: [],
          errors: [`Routing skipped for ${label}: no tools available.`],
        };
      }

      const attemptErrors: string[] = [];
      const aggregatedRoutes: AgentOutput['routes'] = [];
      const anthropicRouteTools = tools.map((tool) =>
        this.agentConversation.toAnthropicTool(tool),
      );

      for (let index = 0; index < targetTokensForRouting.length; index++) {
        const targetToken = targetTokensForRouting[index];

        const routePrompt = await this.promptBuilder.buildRouteSystemPrompt({
          inputTokenAddress,
          targetToken,
          routeIndex: index,
          totalRoutes: targetTokensForRouting.length,
        });

        this.logger.log(
          `Executing route.agent.prompt for route ${index + 1}/${targetTokensForRouting.length}: ${inputTokenAddress} -> ${targetToken.address} (${label})`,
        );

        const inputToken = {
          address: inputTokenAddress,
          symbol: resolvedInputSymbol ?? 'UNKNOWN',
        };

        try {
          const routeResponse =
            await this.agentConversation.runAgentConversation({
              systemPrompt: routePrompt,
              userContent: {
                inputToken,
                targetToken,
                amount: amountSplits[index],
                totalAmount: amount,
                routeIndex: index,
                totalRoutes: targetTokensForRouting.length,
              },
              tools: anthropicRouteTools,
              askClient,
              maxIterations: MAX_ITERATIONS,
            });

          const routeResult = this.agentConversation.parseRouteResponse(
            routeResponse,
            amountSplits[index],
          );
          if (routeResult.errors && routeResult.errors.length > 0) {
            attemptErrors.push(...routeResult.errors);
          }

          if (routeResult.routes && routeResult.routes.length > 0) {
            aggregatedRoutes.push(...routeResult.routes);
          }
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Route discovery failed with unknown error.';
          this.logger.warn(`Routing attempt via ${label} failed: ${message}`);
          attemptErrors.push(`Routing attempt via ${label} failed: ${message}`);
          return {
            success: false,
            routes: [],
            errors: attemptErrors,
          };
        }
      }

      if (aggregatedRoutes.length === 0) {
        attemptErrors.push(`Routing with ${label} tools returned no routes.`);
        return {
          success: false,
          routes: [],
          errors: attemptErrors,
        };
      }

      return {
        success: true,
        routes: aggregatedRoutes,
        errors: attemptErrors,
      };
    };

    let attemptSucceeded = false;
    const providerAttempts = [
      { label: 'ask_starknet/ekubo*', tools: ekuboTools },
      { label: 'ask_starknet/avnu*', tools: avnuTools },
    ];

    for (const provider of providerAttempts) {
      const result = await attemptRouteWithTools(
        provider.tools,
        provider.label,
      );
      if (result.errors.length > 0) {
        routeErrors.push(...result.errors);
      }
      if (result.success) {
        routes = result.routes;
        attemptSucceeded = true;
        break;
      }
    }

    if (!attemptSucceeded && routerFallback) {
      this.logger.warn(
        'Routing providers failed or unavailable; attempting ask_starknet router fallback.',
      );
      const fallbackResult = await attemptRouteWithTools(
        [routerFallback],
        'ask_starknet router fallback',
      );
      if (fallbackResult.errors.length > 0) {
        routeErrors.push(...fallbackResult.errors);
      }
      if (fallbackResult.success) {
        routes = fallbackResult.routes;
        attemptSucceeded = true;
      }
    }

    if (!attemptSucceeded) {
      this.logger.warn(
        'No routing tools produced a route; returning yield data only.',
      );
      routeErrors.push(
        'Routing skipped: no route provider produced a valid route.',
      );
    }

    return { routes, routeErrors };
  }

  private async ensureTokenSymbol(
    tokenAddress: string,
    askClient: AskClient,
    allowedCapabilities: ToolDef[],
  ): Promise<{
    symbol: string | null;
    errors: string[];
    usedPrompt: boolean;
  }> {
    const cached = this.cacheService.getCachedTokenSymbol(tokenAddress);
    if (cached) {
      return { symbol: cached, errors: [], usedPrompt: false };
    }

    const symbolTools =
      this.tokenResolver.selectSymbolTools(allowedCapabilities);
    if (symbolTools.length === 0) {
      this.logger.warn(
        'Token symbol tools unavailable; skipping symbol lookup.',
      );
      return {
        symbol: null,
        errors: [
          'Token symbol lookup skipped: no symbol-capable tools available.',
        ],
        usedPrompt: false,
      };
    }

    const anthropicTools = symbolTools.map((tool) =>
      this.agentConversation.toAnthropicTool(tool),
    );
    try {
      const systemPrompt =
        await this.promptBuilder.buildTokenSymbolPrompt(tokenAddress);
      const response = await this.agentConversation.runAgentConversation({
        systemPrompt,
        userContent: { token: { address: tokenAddress } },
        tools: anthropicTools,
        askClient,
        maxIterations: MAX_ITERATIONS,
      });

      const result = this.tokenResolver.parseTokenSymbolResponse(
        response,
        tokenAddress,
        (raw) => this.agentConversation.parseAgentJson(raw),
        (value) => this.agentConversation.isRecord(value),
      );
      if (result.symbol && result.symbol !== 'UNKNOWN') {
        this.cacheService.setCachedTokenSymbol(tokenAddress, result.symbol);
      }

      return { ...result, usedPrompt: true };
    } catch (error) {
      const message =
        error instanceof Error
          ? `Token symbol lookup failed: ${error.message}`
          : 'Token symbol lookup failed due to an unknown error.';
      this.logger.warn(message, error instanceof Error ? error : undefined);
      return { symbol: null, errors: [message], usedPrompt: true };
    }
  }

  private async getAskClient(): Promise<AskClient> {
    if (this.askClient) {
      return this.askClient;
    }
    const env = this.buildTransportEnv();
    const adapter = new StdioAskStarknetAdapter({
      logger: this.logger,
      command: this.configService.get<string>('ASK_STARKNET_COMMAND') ?? 'npx',
      args: this.resolveCommandArgs(),
      env,
      clientName: 'yield-optimizer-ask-starknet',
      clientVersion: '1.0.0',
    });

    await adapter.connect();
    this.askClient = adapter;
    this.askClientCleanup = () => adapter.close();
    return adapter;
  }

  private resolveCommandArgs(): string[] {
    const raw = this.configService.get<string>('ASK_STARKNET_ARGS');
    const fallback = ['-y', '@kasarlabs/ask-starknet-mcp'];

    if (!raw) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(raw);
      if (
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === 'string')
      ) {
        return parsed;
      }
    } catch {
      const tokens = raw.split(/\s+/).filter(Boolean);
      if (tokens.length > 0) {
        return tokens;
      }
    }

    this.logger.warn(
      'ASK_STARKNET_ARGS is invalid; falling back to "-y @kasarlabs/ask-starknet-mcp"',
    );
    return fallback;
  }

  private buildTransportEnv(): Record<string, string> {
    const env: Record<string, string> = {};

    const keys = [
      'STARKNET_RPC_URL',
      'STARKNET_PRIVATE_KEY',
      'STARKNET_PUBLIC_ADDRESS',
      'STARKNET_ACCOUNT_ADDRESS',
      'MODEL_API_KEY',
      'ANTHROPIC_API_KEY',
      'GEMINI_API_KEY',
      'OPENAI_API_KEY',
      'MODEL_NAME',
      'LANGSMITH_API_KEY',
      'LANGSMITH_PROJECT',
      'LANGSMITH_ENABLED',
      'LANGSMITH_TRACING',
      'LANGCHAIN_API_KEY',
      'LANGCHAIN_PROJECT',
      'LANGCHAIN_TRACING_V2',
      'NODE_ENV',
    ];

    for (const key of keys) {
      const value = this.configService.get<string>(key) ?? process.env[key];
      if (value) {
        env[key] = value;
      }
    }

    // Ensure MODEL_API_KEY is set if ANTHROPIC_API_KEY is available
    if (!env.MODEL_API_KEY && env.ANTHROPIC_API_KEY) {
      env.MODEL_API_KEY = env.ANTHROPIC_API_KEY;
    }

    if (!env.LANGCHAIN_API_KEY && env.LANGSMITH_API_KEY) {
      env.LANGCHAIN_API_KEY = env.LANGSMITH_API_KEY;
    }

    if (!env.LANGCHAIN_PROJECT && env.LANGSMITH_PROJECT) {
      env.LANGCHAIN_PROJECT = env.LANGSMITH_PROJECT;
    }

    if (env.LANGSMITH_ENABLED === 'true' || env.LANGSMITH_TRACING === 'true') {
      env.LANGCHAIN_TRACING_V2 = 'true';
    }

    return env;
  }

  private async closeAskClient(): Promise<void> {
    if (this.askClientCleanup) {
      try {
        await this.askClientCleanup();
      } catch (error) {
        this.logger.error(
          'Failed to shut down ask-starknet client cleanly',
          error,
        );
      }
      this.askClientCleanup = null;
    }

    this.askClient = null;
  }
}
