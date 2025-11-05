import { Injectable, Logger } from '@nestjs/common';
import type { ToolDef } from '../../mcp/askStarknetClient.js';
import type {
  AskClient,
  YieldToken,
  TokenSymbolLookupResult,
} from '../types/agent.types.js';

@Injectable()
export class TokenResolverService {
  private readonly logger = new Logger(TokenResolverService.name);

  selectSymbolTools(allowedCapabilities: ToolDef[]): ToolDef[] {
    const direct = allowedCapabilities.filter(
      (tool) => tool.name === 'ask_starknet/erc20_symbol',
    );
    if (direct.length > 0) {
      return direct;
    }

    const router = allowedCapabilities.find(
      (tool) =>
        tool.name === 'ask_starknet' || tool.name === 'ask_starknet/router',
    );
    return router ? [router] : [];
  }

  async resolveSwapTokenSymbol(
    token: YieldToken,
    getCachedSymbol: (address: string) => string | null,
    setCachedSymbol: (address: string, symbol: string) => void,
    ensureSymbol: (
      tokenAddress: string,
      askClient: AskClient,
      allowedCapabilities: ToolDef[],
      maxIterations: number,
    ) => Promise<TokenSymbolLookupResult>,
    askClient: AskClient,
    allowedCapabilities: ToolDef[],
    maxIterations: number,
  ): Promise<{ token: YieldToken; errors: string[]; usedPrompt: boolean }> {
    let resolvedSymbol = token.symbol;
    let usedPrompt = false;
    const errors: string[] = [];

    if (!resolvedSymbol || resolvedSymbol === 'UNKNOWN') {
      const lookup = await ensureSymbol(
        token.address,
        askClient,
        allowedCapabilities,
        maxIterations,
      );
      usedPrompt = lookup.usedPrompt;
      if (lookup.errors.length > 0) {
        errors.push(...lookup.errors);
      }
      if (lookup.symbol) {
        resolvedSymbol = lookup.symbol;
      } else {
        const cachedSymbol = getCachedSymbol(token.address);
        if (cachedSymbol) {
          resolvedSymbol = cachedSymbol;
        }
      }
    }

    const finalSymbol =
      resolvedSymbol && resolvedSymbol.trim().length > 0
        ? resolvedSymbol
        : 'UNKNOWN';
    const decimals = typeof token.decimals === 'number' ? token.decimals : 18;

    const resolvedToken: YieldToken = {
      ...token,
      symbol: finalSymbol,
      decimals,
    };

    if (finalSymbol !== 'UNKNOWN') {
      setCachedSymbol(resolvedToken.address, finalSymbol);
    }

    return { token: resolvedToken, errors, usedPrompt };
  }

  parseTokenSymbolResponse(
    raw: string,
    expectedAddress: string,
    parseAgentJson: (raw: string) => unknown,
    isRecord: (value: unknown) => value is Record<string, unknown>,
  ): Omit<TokenSymbolLookupResult, 'usedPrompt'> {
    const parsed = parseAgentJson(raw);
    if (!isRecord(parsed)) {
      throw new Error('Token symbol agent response is not an object.');
    }

    const payload = parsed as Record<string, unknown>;
    let symbol: string | null = null;

    const errors: string[] = Array.isArray(payload.errors)
      ? payload.errors.filter(
          (item): item is string => typeof item === 'string',
        )
      : [];

    if (isRecord(payload.token)) {
      const token = payload.token as Record<string, unknown>;
      if (
        typeof token.address === 'string' &&
        token.address.toLowerCase() !== expectedAddress.toLowerCase()
      ) {
        this.logger.warn(
          `Token symbol response address mismatch: expected ${expectedAddress}, received ${token.address}`,
        );
      }

      if (typeof token.symbol === 'string') {
        const trimmed = token.symbol.trim();
        if (trimmed.length > 0) {
          symbol = trimmed;
        }
      }
    }

    if (!symbol && typeof payload.symbol === 'string') {
      const trimmed = payload.symbol.trim();
      if (trimmed.length > 0) {
        symbol = trimmed;
      }
    }

    if (symbol && symbol.length > 0) {
      return { symbol, errors };
    }

    return {
      symbol: null,
      errors: errors.length > 0 ? errors : ['Token symbol not returned.'],
    };
  }
}

