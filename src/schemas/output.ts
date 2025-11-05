import { z } from 'zod';

export const TokenSchema = z.object({
  symbol: z.string().min(1),
  address: z.string().regex(/^0x[0-9a-fA-F]+$/),
  decimals: z.number().int().min(0).max(36),
});

export const RouteSchema = z.object({
  from_token: z.object({
    symbol: z.string().optional(),
    address: z.string().regex(/^0x[0-9a-fA-F]+$/),
    decimals: z.number().int().optional(),
  }),
  to_token: z.object({
    symbol: z.string().optional(),
    address: z.string().regex(/^0x[0-9a-fA-F]+$/),
    decimals: z.number().int().optional(),
  }),
  amount_in: z.string().regex(/^\d+$/),
  min_amount_out: z.string().regex(/^\d+$/).optional(),
  slippage_bps: z.number().int().min(1).max(1000).optional(),
  hops: z
    .array(
      z.object({
        dex: z.enum(['AVNU', 'Ekubo']),
        pool: z.string().min(1).optional(),
        quote_out: z.string().regex(/^\d+$/).optional(),
      }),
    )
    .optional(),
  quote_provider: z.enum(['avnu', 'ekubo', 'unavailable']).optional(),
  quote_valid_until: z.string().min(1).optional(),
});

const ZERO_ADDRESS_REGEX = /^0x0+$/;
const isZeroAddress = (address: unknown): boolean =>
  typeof address === 'string' && ZERO_ADDRESS_REGEX.test(address.toLowerCase());

type ParsedRoute = z.infer<typeof RouteSchema>;

export const OutputSchema = z
  .object({
    yield: z.object({
      protocol: z.string().min(1),
      apy_pct: z.number().finite(),
      deposit_token: z.union([TokenSchema, z.array(TokenSchema).min(1)]),
      pool_or_contract_address: z
        .string()
        .regex(/^0x[0-9a-fA-F]+$/)
        .nullable()
        .optional(),
      source: z.enum(['troves', 'endurfi']),
      snapshot_at: z.string().min(1).nullable().optional(),
    }),
    route: RouteSchema.optional(),
    routes: z.array(RouteSchema).optional(),
    errors: z.array(z.string()).optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    const ensureValidDepositToken = (
      token: unknown,
      path: (string | number)[],
    ) => {
      if (!token || typeof token !== 'object') return;
      const address = (token as { address?: unknown }).address;
      if (isZeroAddress(address)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid deposit_token address (cannot be 0x0)',
          path: [...path, 'address'],
        });
      }
    };

    const depositToken = data.yield.deposit_token;
    if (Array.isArray(depositToken)) {
      depositToken.forEach((token, index) =>
        ensureValidDepositToken(token, ['yield', 'deposit_token', index]),
      );
    } else {
      ensureValidDepositToken(depositToken, ['yield', 'deposit_token']);
    }

    const routesToCheck: Array<{
      route: ParsedRoute;
      path: (string | number)[];
    }> = [];
    if (data.route) {
      routesToCheck.push({ route: data.route, path: ['route'] });
    }
    if (data.routes) {
      data.routes.forEach((route, index) => {
        routesToCheck.push({ route, path: ['routes', index] });
      });
    }

    for (const { route, path } of routesToCheck) {
      const fromAddress = route.from_token.address.toLowerCase();
      const toAddress = route.to_token.address.toLowerCase();
      if (fromAddress !== toAddress) {
        continue;
      }

      const hops = route.hops ?? [];
      if (hops.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Route hops must be empty when from_token and to_token match',
          path: [...path, 'hops'],
        });
      }

      if (route.min_amount_out === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'min_amount_out is required when from_token and to_token match',
          path: [...path, 'min_amount_out'],
        });
        continue;
      }

      if (route.amount_in !== route.min_amount_out) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'min_amount_out must equal amount_in when from_token and to_token match',
          path: [...path, 'min_amount_out'],
        });
      }
    }
  });
