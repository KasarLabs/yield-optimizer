import { Injectable } from '@nestjs/common';
import { McpAgentService, type AgentOutput } from './mcp-agent.service.js';

@Injectable()
export class AppService {
  constructor(private readonly mcpAgentService: McpAgentService) {}

  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  isValidStarknetAddress(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }

    // Starknet addresses start with "0x" and are 66 characters long (0x + 64 hex characters)
    // They can also be shorter if they don't have leading zeros
    const starknetAddressRegex = /^0x[0-9a-fA-F]{1,64}$/;

    // Check if it matches the pattern
    if (!starknetAddressRegex.test(address)) {
      return false;
    }

    // For a valid Starknet address, after "0x" there should be at least 1 hex character
    // and maximum 64 hex characters
    const hexPart = address.slice(2);
    return hexPart.length >= 1 && hexPart.length <= 64;
  }

  async findOptimalYieldPath(
    tokenAddress: string,
    amount: string,
  ): Promise<AgentOutput> {
    return await this.mcpAgentService.findBestYieldPath(tokenAddress, amount);
  }
}
