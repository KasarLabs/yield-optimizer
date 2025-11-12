import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { ZodError } from 'zod';
import { OutputSchema, RouteSchema } from '../../schemas/output.js';
import type { ToolDef } from '../../mcp/askStarknetClient.js';
import type {
  AskClient,
  AgentOutput,
  ParsedRoute,
} from '../types/agent.types.js';

@Injectable()
export class AgentConversationService {
  private readonly logger = new Logger(AgentConversationService.name);

  constructor(
    private readonly anthropic: Anthropic,
    private readonly model: string,
  ) {}

  async runAgentConversation(params: {
    systemPrompt: string;
    userContent: unknown;
    tools: Anthropic.Tool[];
    askClient: AskClient;
    maxIterations: number;
  }): Promise<string> {
    const { systemPrompt, userContent, tools, askClient, maxIterations } =
      params;

    const messages: MessageParam[] = [
      {
        role: 'user',
        content:
          typeof userContent === 'string'
            ? userContent
            : JSON.stringify(userContent),
      },
    ];

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const response = await this.anthropic.messages.create({
        model: this.model,
        system: systemPrompt,
        max_tokens: 1024,
        messages,
        tools,
        metadata: {
          user_id: 'yield-optimizer',
        },
      });

      const toolUses = response.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use',
      );

      if (toolUses.length === 0) {
        return response.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n');
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: ToolResultBlockParam[] = [];

      for (const toolUse of toolUses) {
        const args =
          toolUse.input && typeof toolUse.input === 'object'
            ? (toolUse.input as Record<string, unknown>)
            : {};

        try {
          const result = await askClient.callTool(toolUse.name, args);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown tool error';
          this.logger.error(`Tool ${toolUse.name} failed`, error);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            is_error: true,
            content: message,
          });
        }
      }

      messages.push({
        role: 'user',
        content: toolResults,
      });
    }

    throw new Error(
      'Agent exceeded maximum iterations without producing a result',
    );
  }

  parseRouteResponse(
    raw: string,
    expectedAmount: string,
  ): {
    routes: ParsedRoute[];
    errors?: string[];
  } {
    const parsed = this.parseAgentJson(raw);
    const transformed = this.transformAgentResponse(parsed);
    const withDefaults = this.applyDefaults(transformed);

    if (!this.isRecord(withDefaults)) {
      this.logger.error('Route agent response is not an object', withDefaults);
      throw new Error('Route agent response is not an object.');
    }

    const payload = withDefaults as Record<string, unknown>;

    const result: {
      routes: ParsedRoute[];
      errors?: string[];
    } = {
      routes: [],
    };

    const normalizeRoute = (route: ParsedRoute): ParsedRoute => {
      const hops = route.hops ? [...route.hops] : [];
      const normalized: ParsedRoute = {
        ...route,
        amount_in: expectedAmount,
        hops,
      };

      const fromAddress = route.from_token.address.toLowerCase();
      const toAddress = route.to_token.address.toLowerCase();
      if (fromAddress === toAddress) {
        normalized.hops = [];
        normalized.min_amount_out = expectedAmount;
      } else if (normalized.min_amount_out === undefined) {
        this.logger.warn(
          `Route missing min_amount_out for ${fromAddress} -> ${toAddress}; leaving undefined.`,
        );
      }

      return normalized;
    };

    // Handle both route (single) and routes (array) from the agent response
    // Always convert to routes array
    if (this.isRecord(payload.route)) {
      try {
        const parsedRoute = RouteSchema.parse(payload.route);
        result.routes.push(normalizeRoute(parsedRoute));
      } catch (error) {
        this.logger.error(
          'Route agent response failed schema validation',
          error,
        );
        this.logger.error(
          'Route object:',
          JSON.stringify(payload.route, null, 2),
        );
        if (error instanceof ZodError) {
          this.logger.error(
            'Validation errors:',
            JSON.stringify(error.errors, null, 2),
          );
          const errorMessages = error.errors
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join('; ');
          throw new Error(
            `Route agent response failed schema validation: ${errorMessages}`,
          );
        }
        throw error;
      }
    }

    if (Array.isArray(payload.routes)) {
      try {
        const parsedRoutes = payload.routes.map((route) => {
          const parsedRoute = RouteSchema.parse(route);
          return normalizeRoute(parsedRoute);
        });
        result.routes.push(...parsedRoutes);
      } catch (error) {
        this.logger.error(
          'Route agent response failed schema validation for routes array',
          error,
        );
        if (error instanceof ZodError) {
          const errorMessages = error.errors
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join('; ');
          throw new Error(
            `Route agent response failed schema validation: ${errorMessages}`,
          );
        }
        throw error;
      }
    }

    if (Array.isArray(payload.errors)) {
      result.errors = payload.errors.filter(
        (item): item is string => typeof item === 'string',
      );
    }

    if (result.routes.length === 0) {
      // Check for error-only responses (missing route object)
      if (
        payload.errors &&
        Array.isArray(payload.errors) &&
        payload.errors.length > 0
      ) {
        const errorMessages = payload.errors
          .filter((item): item is string => typeof item === 'string')
          .join('; ');
        this.logger.error('Route agent returned errors without route data', {
          errors: payload.errors,
        });
        throw new Error(`Unable to determine swap route: ${errorMessages}`);
      }
      this.logger.error('Route agent did not return any route data.', payload);
      throw new Error('Route agent response missing route information.');
    }

    return result;
  }

  parseAgentOutput(raw: string): AgentOutput {
    const parsed = this.parseAgentJson(raw);
    const transformed = this.transformAgentResponse(parsed);
    const withDefaults = this.applyDefaults(transformed);

    // Check for error-only responses (missing yield object)
    if (this.isRecord(withDefaults)) {
      const obj = withDefaults as Record<string, unknown>;
      if (
        !obj.yield &&
        obj.errors &&
        Array.isArray(obj.errors) &&
        obj.errors.length > 0
      ) {
        const errorMessages = obj.errors
          .filter((item): item is string => typeof item === 'string')
          .join('; ');
        this.logger.error('Agent returned errors without yield data', {
          errors: obj.errors,
        });
        throw new Error(
          `Unable to determine best yield strategy: ${errorMessages}`,
        );
      }
    }

    try {
      return OutputSchema.parse(withDefaults);
    } catch (error) {
      this.logger.error('Agent response failed schema validation', error);
      this.logger.error('Parsed object:', JSON.stringify(parsed, null, 2));
      this.logger.error(
        'Transformed object:',
        JSON.stringify(transformed, null, 2),
      );
      if (error instanceof ZodError) {
        this.logger.error(
          'Validation errors:',
          JSON.stringify(error.errors, null, 2),
        );
      }
      throw new Error(
        `Agent response failed schema validation: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  parseAgentJson(raw: string): unknown {
    const trimmed = raw.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');

    if (start === -1 || end === -1 || end <= start) {
      this.logger.error(`Agent did not return JSON: ${trimmed}`);
      const snippet =
        trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
      throw new Error(`Agent response is not valid JSON. Response: ${snippet}`);
    }

    const candidate = trimmed.slice(start, end + 1);

    try {
      return JSON.parse(candidate);
    } catch (error) {
      this.logger.error(`Failed to parse agent JSON: ${candidate}`, error);
      const snippet =
        candidate.length > 200 ? `${candidate.slice(0, 200)}...` : candidate;
      throw new Error(`Agent response JSON parse failed. Response: ${snippet}`);
    }
  }

  private transformAgentResponse(data: unknown): unknown {
    if (!this.isRecord(data)) {
      return data;
    }

    const obj = data as Record<string, unknown>;
    const transformed: Record<string, unknown> = {};

    const yieldData = this.extractYieldData(obj);
    if (yieldData) {
      transformed.yield = yieldData;
    }

    this.extractRouteData(obj, transformed);

    if (obj.errors) {
      transformed.errors = obj.errors;
    }

    return transformed;
  }

  private extractYieldData(
    obj: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (this.isRecord(obj.selected_strategy)) {
      const strategy = obj.selected_strategy as Record<string, unknown>;
      return {
        protocol: strategy.strategy_name || strategy.protocol || 'UNKNOWN',
        apy_pct: strategy.apy_pct || 0,
        deposit_token: Array.isArray(strategy.deposit_token)
          ? strategy.deposit_token
          : strategy.deposit_token
            ? [strategy.deposit_token]
            : [
                {
                  symbol: 'UNKNOWN',
                  address: '0x0',
                  decimals: 18,
                },
              ],
        pool_or_contract_address:
          strategy.contract_address ||
          strategy.pool_or_contract_address ||
          null,
        source: strategy.source || 'troves',
        snapshot_at:
          strategy.snapshot_at !== undefined
            ? strategy.snapshot_at
            : new Date().toISOString(),
      };
    }

    if (this.isRecord(obj.yield)) {
      return obj.yield as Record<string, unknown>;
    }

    return undefined;
  }

  private extractRouteData(
    obj: Record<string, unknown>,
    target: Record<string, unknown>,
  ): void {
    // Always convert to routes array
    const routes: unknown[] = [];

    if (Array.isArray(obj.swap_routes)) {
      routes.push(
        ...obj.swap_routes.map((route) =>
          this.isRecord(route)
            ? this.transformSingleRoute(route as Record<string, unknown>)
            : route,
        ),
      );
    } else if (this.isRecord(obj.swap_route)) {
      routes.push(
        this.transformSingleRoute(obj.swap_route as Record<string, unknown>),
      );
    } else if (Array.isArray(obj.routes)) {
      routes.push(...obj.routes);
    } else if (this.isRecord(obj.route)) {
      routes.push(obj.route);
    }

    if (routes.length > 0) {
      target.routes = routes;
    }
  }

  private transformSingleRoute(
    swapRoute: Record<string, unknown>,
  ): Record<string, unknown> {
    const fromToken =
      typeof swapRoute.from_token === 'string'
        ? {
            address: swapRoute.from_token,
            symbol: 'UNKNOWN',
            decimals: 18,
          }
        : this.isRecord(swapRoute.from_token)
          ? (swapRoute.from_token as Record<string, unknown>)
          : { address: '0x0', symbol: 'UNKNOWN', decimals: 18 };

    const toToken =
      typeof swapRoute.to_token === 'string'
        ? {
            address: swapRoute.to_token,
            symbol: 'UNKNOWN',
            decimals: 18,
          }
        : this.isRecord(swapRoute.to_token)
          ? (swapRoute.to_token as Record<string, unknown>)
          : { address: '0x0', symbol: 'UNKNOWN', decimals: 18 };

    return {
      from_token: fromToken,
      to_token: toToken,
      amount_in: swapRoute.amount_in || '0',
      min_amount_out: swapRoute.min_amount_out,
      slippage_bps: swapRoute.slippage_bps || 50,
      hops: swapRoute.hops || [],
      quote_provider: swapRoute.quote_provider,
      quote_valid_until: swapRoute.quote_valid_until,
    };
  }

  private applyDefaults(data: unknown): unknown {
    if (!this.isRecord(data)) {
      return data;
    }

    const obj = data as Record<string, unknown>;

    // Helper function to apply defaults to a single route
    const applyRouteDefaults = (route: Record<string, unknown>): void => {
      if (!route.hops) route.hops = [];
      if (!route.slippage_bps) route.slippage_bps = 50;

      if (this.isRecord(route.from_token)) {
        const ft = route.from_token as Record<string, unknown>;
        if (!ft.symbol) ft.symbol = 'UNKNOWN';
        if (!ft.decimals) ft.decimals = 18;
      }

      if (this.isRecord(route.to_token)) {
        const tt = route.to_token as Record<string, unknown>;
        if (!tt.symbol) tt.symbol = 'UNKNOWN';
        if (!tt.decimals) tt.decimals = 18;
      }
    };

    // Apply defaults for routes (array)
    if (obj.routes && Array.isArray(obj.routes)) {
      obj.routes.forEach((route) => {
        if (this.isRecord(route)) {
          applyRouteDefaults(route as Record<string, unknown>);
        }
      });
    }
    // Apply defaults for route (single object) - convert to routes array
    else if (this.isRecord(obj.route)) {
      applyRouteDefaults(obj.route as Record<string, unknown>);
      // Convert single route to routes array
      if (!obj.routes) {
        obj.routes = [obj.route];
      }
      delete obj.route;
    }
    // Ensure routes always exists as an array (required by schema)
    else if (!obj.routes) {
      obj.routes = [];
    }

    // Apply defaults for yield deposit_token (always convert to array)
    if (this.isRecord(obj.yield)) {
      const yieldObj = obj.yield as Record<string, unknown>;
      if (yieldObj.deposit_token) {
        // Convert to array if it's a single object
        if (!Array.isArray(yieldObj.deposit_token)) {
          if (this.isRecord(yieldObj.deposit_token)) {
            yieldObj.deposit_token = [yieldObj.deposit_token];
          } else {
            yieldObj.deposit_token = [];
          }
        }
        // Apply defaults to all tokens in the array
        yieldObj.deposit_token = (yieldObj.deposit_token as unknown[]).map(
          (token) => {
            if (this.isRecord(token)) {
              const dt = token as Record<string, unknown>;
              if (!dt.symbol) dt.symbol = 'UNKNOWN';
              if (!dt.decimals) dt.decimals = 18;
            }
            return token;
          },
        );
      }
    }

    if (!obj.errors) obj.errors = [];

    return obj;
  }

  isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  toAnthropicTool(tool: ToolDef): Anthropic.Tool {
    const base: Record<string, unknown> =
      tool.parameters && typeof tool.parameters === 'object'
        ? { ...tool.parameters }
        : {};

    if (typeof base.type !== 'string') {
      base.type = 'object';
    }
    if (typeof base.properties !== 'object' || base.properties === null) {
      base.properties = {};
    }

    return {
      name: tool.name,
      description: tool.description ?? '',
      input_schema: base as Anthropic.Tool['input_schema'],
    };
  }
}
