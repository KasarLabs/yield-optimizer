import type { z } from 'zod';
import type { OutputSchema, RouteSchema, TokenSchema } from '../../schemas/output.js';
import type { AskStarknetClient } from '../../mcp/askStarknetClient.js';

export const MAX_ITERATIONS = 12;

export type AskClient = Pick<AskStarknetClient, 'listTools' | 'callTool'>;

export type AgentOutput = z.infer<typeof OutputSchema>;

export type YieldCacheEntry = {
  yield: AgentOutput['yield'];
  timestamp: number;
};

export type RouteCacheEntry = {
  route?: AgentOutput['route'];
  routes?: AgentOutput['routes'];
  errors?: string[];
  yieldFingerprint: string;
  timestamp: number;
};

export type TokenSymbolCacheEntry = {
  symbol: string;
  timestamp: number;
};

export type TokenSymbolLookupResult = {
  symbol: string | null;
  errors: string[];
  usedPrompt: boolean;
};

export type YieldToken = z.infer<typeof TokenSchema>;

export type ParsedRoute = z.infer<typeof RouteSchema>;

