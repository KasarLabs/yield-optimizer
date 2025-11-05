export class AgentUtils {
  static splitAmount(amount: string, parts: number): string[] {
    if (parts <= 0) {
      throw new Error('Cannot split amount across zero routes.');
    }

    if (parts === 1) {
      return [amount];
    }

    let total: bigint;
    try {
      total = BigInt(amount);
    } catch {
      throw new Error(
        'Amount must be an integer string to support route splitting.',
      );
    }

    if (total < 0n) {
      throw new Error('Amount must be non-negative.');
    }

    const bigParts = BigInt(parts);
    const base = total / bigParts;
    const remainder = total % bigParts;
    const splits: string[] = [];

    for (let i = 0; i < parts; i++) {
      const isLast = i === parts - 1;
      const portion = base + (isLast ? remainder : 0n);
      splits.push(portion.toString());
    }

    return splits;
  }

  static isAskStarknetRouter(toolName: string): boolean {
    return toolName === 'ask_starknet' || toolName === 'ask_starknet/router';
  }
}

