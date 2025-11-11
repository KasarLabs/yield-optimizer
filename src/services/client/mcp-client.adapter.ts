import { Logger } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDef, ToolResult } from '../../mcp/askStarknetClient.js';
import type { AskClient } from '../types/agent.types.js';

export type StdioAdapterOptions = {
  logger: Logger;
  command: string;
  args: string[];
  env: Record<string, string>;
  clientName: string;
  clientVersion: string;
};

export class StdioAskStarknetAdapter implements AskClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor(private readonly options: StdioAdapterOptions) {}

  async connect(): Promise<void> {
    await this.ensureConnected();
  }

  async listTools(): Promise<ToolDef[]> {
    await this.ensureConnected();
    const client = this.getClient();
    const { tools } = await client.listTools();
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? undefined,
      parameters: tool.inputSchema ?? undefined,
    }));
  }

  async callTool(name: string, args: object): Promise<ToolResult> {
    await this.ensureConnected();
    const client = this.getClient();
    const payload = args as Record<string, unknown>;
    return client.callTool({ name, arguments: payload });
  }

  async close(): Promise<void> {
    this.connectPromise = null;
    const closers: Promise<void>[] = [];
    if (this.client) {
      closers.push(
        this.client.close().catch((error) => {
          this.options.logger.error(
            'Error closing ask-starknet MCP client',
            error,
          );
        }),
      );
      this.client = null;
    }
    if (this.transport) {
      closers.push(
        this.transport.close().catch((error) => {
          this.options.logger.error(
            'Error closing ask-starknet transport',
            error,
          );
        }),
      );
      this.transport = null;
    }
    if (closers.length > 0) {
      await Promise.all(closers);
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client) {
      return;
    }

    if (!this.connectPromise) {
      this.connectPromise = this.establishConnection().catch((error) => {
        this.connectPromise = null;
        throw error;
      });
    }

    await this.connectPromise;
  }

  private async establishConnection(): Promise<void> {
    this.options.logger.log(
      `Connecting to ask-starknet via ${this.options.command} ${this.options.args.join(' ')}`.trim(),
    );

    const transport = new StdioClientTransport({
      command: this.options.command,
      args: this.options.args,
      env: this.options.env,
    });

    const client = new Client(
      {
        name: this.options.clientName,
        version: this.options.clientVersion,
      },
      {
        capabilities: {},
      },
    );

    try {
      await client.connect(transport);
      this.client = client;
      this.transport = transport;
      this.options.logger.log('ask-starknet MCP transport connected');
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw error;
    }
  }

  private getClient(): Client {
    if (!this.client) {
      throw new Error('ask-starknet MCP client is not connected');
    }
    return this.client;
  }
}
