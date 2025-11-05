export type ToolDef = {
  name: string;
  description?: string;
  parameters?: object;
};
export type ToolResult = unknown;

/**
 * Interface defining the shape of an ask-starknet client.
 * Used for type checking only - the actual implementation is provided by StdioAskStarknetAdapter.
 */
export interface AskStarknetClient {
  listTools(): Promise<ToolDef[]>;
  callTool(name: string, args: object): Promise<ToolResult>;
}
