import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type {
  AgentOutput,
  YieldCacheEntry,
  RouteCacheEntry,
  TokenSymbolCacheEntry,
} from '../types/agent.types.js';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private yieldCache: YieldCacheEntry | null = null; // Single global yield cache
  private readonly routeCache = new Map<string, RouteCacheEntry>();
  private readonly tokenSymbolCache = new Map<string, TokenSymbolCacheEntry>();
  private readonly MAX_CACHE_SIZE = 1000;
  private readonly CACHE_TTL_MS: number;
  private readonly TOKEN_SYMBOL_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  constructor(private readonly configService: ConfigService) {
    const cacheTtlMs = this.configService.get<string>('CACHE_TTL_MS');
    this.CACHE_TTL_MS = cacheTtlMs
      ? parseInt(cacheTtlMs, 10)
      : 24 * 60 * 60 * 1000;
  }

  // ========== Yield Cache ==========
  getCachedYield(): AgentOutput['yield'] | null {
    if (!this.yieldCache) {
      return null;
    }

    const now = Date.now();
    const age = now - this.yieldCache.timestamp;

    if (age > this.CACHE_TTL_MS) {
      this.yieldCache = null;
      const ageHours = Math.round(age / 1000 / 60 / 60);
      this.logger.log(`Yield cache expired (age: ${ageHours}h)`);
      return null;
    }

    return this.yieldCache.yield;
  }

  setCachedYield(yieldData: AgentOutput['yield']): void {
    this.yieldCache = {
      yield: yieldData,
      timestamp: Date.now(),
    };
    this.logger.log(`Cached yield data globally`);
  }

  getYieldCacheAge(): number | null {
    if (!this.yieldCache) {
      return null;
    }
    return Math.round((Date.now() - this.yieldCache.timestamp) / 1000 / 60);
  }

  // ========== Route Cache ==========
  getCachedRoute(
    tokenAddress: string,
    amount: string,
    yieldFingerprint: string,
  ): RouteCacheEntry | null {
    const cacheKey = this.getRouteCacheKey(
      tokenAddress,
      amount,
      yieldFingerprint,
    );
    const entry = this.routeCache.get(cacheKey);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    if (age > this.CACHE_TTL_MS) {
      this.routeCache.delete(cacheKey);
      this.logger.log(
        `Route cache expired for token: ${tokenAddress} and amount: ${amount}`,
      );
      return null;
    }

    return entry;
  }

  setCachedRoute(
    tokenAddress: string,
    amount: string,
    yieldFingerprint: string,
    data: {
      route?: AgentOutput['route'];
      routes?: AgentOutput['routes'];
      errors?: string[];
    },
  ): void {
    if (!data.route && (!data.routes || data.routes.length === 0)) {
      return;
    }

    const cacheKey = this.getRouteCacheKey(
      tokenAddress,
      amount,
      yieldFingerprint,
    );

    if (
      this.routeCache.size >= this.MAX_CACHE_SIZE &&
      !this.routeCache.has(cacheKey)
    ) {
      const firstKey = this.routeCache.keys().next().value as
        | string
        | undefined;
      if (firstKey) {
        this.routeCache.delete(firstKey);
        this.logger.log(`Route cache evicted oldest entry: ${firstKey}`);
      }
    }

    this.routeCache.set(cacheKey, {
      route: data.route,
      routes: data.routes,
      errors: data.errors,
      yieldFingerprint,
      timestamp: Date.now(),
    });

    this.logger.log(
      `Cached route result for token: ${tokenAddress} and amount: ${amount}`,
    );
  }

  private getRouteCacheKey(
    tokenAddress: string,
    amount: string,
    yieldFingerprint: string,
  ): string {
    return `${tokenAddress}:${amount}:${yieldFingerprint}`;
  }

  // ========== Token Symbol Cache ==========
  getCachedTokenSymbol(tokenAddress: string): string | null {
    const normalizedAddress = tokenAddress.toLowerCase();
    const entry = this.tokenSymbolCache.get(normalizedAddress);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    if (age > this.TOKEN_SYMBOL_CACHE_TTL_MS) {
      this.tokenSymbolCache.delete(normalizedAddress);
      this.logger.log(`Token symbol cache expired for: ${normalizedAddress}`);
      return null;
    }

    return entry.symbol;
  }

  setCachedTokenSymbol(tokenAddress: string, symbol: string): void {
    const normalizedAddress = tokenAddress.toLowerCase();

    if (
      this.tokenSymbolCache.size >= this.MAX_CACHE_SIZE &&
      !this.tokenSymbolCache.has(normalizedAddress)
    ) {
      const firstKey = this.tokenSymbolCache.keys().next().value as
        | string
        | undefined;
      if (firstKey) {
        this.tokenSymbolCache.delete(firstKey);
        this.logger.log(`Token symbol cache evicted oldest entry: ${firstKey}`);
      }
    }

    this.tokenSymbolCache.set(normalizedAddress, {
      symbol,
      timestamp: Date.now(),
    });
    this.logger.log(
      `Cached token symbol for: ${normalizedAddress} -> ${symbol}`,
    );
  }

  extractAndCacheTokenSymbols(data: AgentOutput): void {
    // Extract symbols from yield deposit_token
    if (data.yield?.deposit_token) {
      const depositToken = data.yield.deposit_token;
      if (Array.isArray(depositToken)) {
        depositToken.forEach((token) => {
          if (token.address && token.symbol && token.symbol !== 'UNKNOWN') {
            this.setCachedTokenSymbol(token.address, token.symbol);
          }
        });
      } else if (
        depositToken.address &&
        depositToken.symbol &&
        depositToken.symbol !== 'UNKNOWN'
      ) {
        this.setCachedTokenSymbol(depositToken.address, depositToken.symbol);
      }
    }

    // Extract symbols from route(s)
    if (data.route) {
      if (
        data.route.from_token?.address &&
        data.route.from_token?.symbol &&
        data.route.from_token.symbol !== 'UNKNOWN'
      ) {
        this.setCachedTokenSymbol(
          data.route.from_token.address,
          data.route.from_token.symbol,
        );
      }
      if (
        data.route.to_token?.address &&
        data.route.to_token?.symbol &&
        data.route.to_token.symbol !== 'UNKNOWN'
      ) {
        this.setCachedTokenSymbol(
          data.route.to_token.address,
          data.route.to_token.symbol,
        );
      }
    }

    if (data.routes) {
      data.routes.forEach((route) => {
        if (
          route.from_token?.address &&
          route.from_token?.symbol &&
          route.from_token.symbol !== 'UNKNOWN'
        ) {
          this.setCachedTokenSymbol(
            route.from_token.address,
            route.from_token.symbol,
          );
        }
        if (
          route.to_token?.address &&
          route.to_token?.symbol &&
          route.to_token.symbol !== 'UNKNOWN'
        ) {
          this.setCachedTokenSymbol(
            route.to_token.address,
            route.to_token.symbol,
          );
        }
      });
    }
  }

  // ========== Utility ==========
  computeYieldFingerprint(yieldData: AgentOutput['yield']): string {
    const depositTokens = Array.isArray(yieldData.deposit_token)
      ? yieldData.deposit_token
      : [yieldData.deposit_token];

    const normalizedTokens = depositTokens.map((token) => ({
      symbol: token.symbol,
      address: token.address.toLowerCase(),
      decimals: token.decimals,
    }));

    const payload = {
      protocol: yieldData.protocol,
      apy_pct: yieldData.apy_pct,
      source: yieldData.source,
      pool_or_contract_address: yieldData.pool_or_contract_address ?? null,
      snapshot_at: yieldData.snapshot_at ?? null,
      deposit_tokens: normalizedTokens,
    };

    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}
