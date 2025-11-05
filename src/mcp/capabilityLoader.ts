import type { AskStarknetClient } from './askStarknetClient.js';

type ClientLike = Pick<AskStarknetClient, 'listTools'>;

export async function loadAllowedTools(client: ClientLike) {
  return await client.listTools(); // { name, description?, parameters? }[]
}
