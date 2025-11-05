import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { YieldToken } from '../types/agent.types.js';

@Injectable()
export class PromptBuilderService {
  async buildYieldSystemPrompt(): Promise<string> {
    const promptPath = this.resolveFromCurrentDir(
      '../../../prompts/yield.agent.prompt.md',
    );
    return readFile(promptPath, 'utf8');
  }

  async buildTokenSymbolPrompt(tokenAddress: string): Promise<string> {
    const promptPath = this.resolveFromCurrentDir(
      '../../../prompts/token-symbol.agent.prompt.md',
    );
    const basePrompt = await readFile(promptPath, 'utf8');
    const contextLines = ['Context:', `- Token address: ${tokenAddress}`];
    return `${basePrompt.trim()}\n\n${contextLines.join('\n')}`;
  }

  async buildRouteSystemPrompt(params: {
    inputTokenAddress: string;
    targetToken: YieldToken;
    routeIndex: number;
    totalRoutes: number;
  }): Promise<string> {
    const promptPath = this.resolveFromCurrentDir(
      '../../../prompts/route.agent.prompt.md',
    );
    const rawPrompt = await readFile(promptPath, 'utf8');
    const contextualLines = [
      'Context:',
      `- Input token address: ${params.inputTokenAddress}`,
      `- Target token address: ${params.targetToken.address}`,
      `- Target token symbol: ${params.targetToken.symbol ?? 'UNKNOWN'}`,
      `- Route index: ${params.routeIndex + 1} of ${params.totalRoutes}`,
    ];

    return `${rawPrompt.trim()}\n\n${contextualLines.join('\n')}`;
  }

  private resolveFromCurrentDir(relativePath: string): string {
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFilePath);
    return join(currentDir, relativePath);
  }
}

