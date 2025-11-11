import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/modules/app.module';
import {
  McpAgentService,
  AgentOutput,
} from '../src/services/mcp-agent.service';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let mcpAgentService: McpAgentService;

  // Mock data matching AgentOutput schema
  const mockYieldPathResult: AgentOutput = {
    yield: {
      protocol: 'JediSwap',
      apy_pct: 12.5,
      deposit_token: [
        {
          symbol: 'USDC',
          address:
            '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
          decimals: 18,
        },
      ],
      pool_or_contract_address:
        '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
      source: 'troves',
      snapshot_at: new Date().toISOString(),
    },
    routes: [
      {
        from_token: {
          address:
            '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
          symbol: 'ETH',
          decimals: 18,
        },
        to_token: {
          address:
            '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
          symbol: 'USDC',
          decimals: 18,
        },
        amount_in: '1000000000000000000',
        min_amount_out: '1250000000',
        slippage_bps: 50,
        hops: [],
      },
    ],
    errors: [],
  };

  const validTokenAddress =
    '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';
  const invalidTokenAddress = '0xinvalid';
  const validAmount = '1000000000000000000';

  beforeEach(async () => {
    const mockMcpAgentService = {
      findBestYieldPath: jest.fn(),
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(McpAgentService)
      .useValue(mockMcpAgentService)
      .compile();

    app = moduleFixture.createNestApplication();

    app.useLogger(false);

    mcpAgentService = moduleFixture.get<McpAgentService>(McpAgentService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('should return health status', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('status');
          expect(res.body).toHaveProperty('timestamp');
          expect(res.body.status).toBe('ok');
        });
    });
  });

  describe('POST /get_path', () => {
    it('should return optimal yield path for valid token address', async () => {
      jest
        .spyOn(mcpAgentService, 'findBestYieldPath')
        .mockResolvedValue(mockYieldPathResult);

      return request(app.getHttpServer())
        .post('/get_path')
        .send({ address: validTokenAddress, amount: validAmount })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('success', true);
          expect(res.body).toHaveProperty('tokenAddress', validTokenAddress);
          expect(res.body).toHaveProperty('result');
          expect(res.body.result).toHaveProperty('yield');
          expect(res.body.result).toHaveProperty('routes');
          expect(res.body.result.routes).toBeInstanceOf(Array);
          expect(res.body.result.yield.apy_pct).toBe(12.5);
          expect(mcpAgentService.findBestYieldPath).toHaveBeenCalledWith(
            validTokenAddress,
            validAmount,
          );
        });
    });

    it('should return 400 when address is missing', () => {
      return request(app.getHttpServer())
        .post('/get_path')
        .send({})
        .expect(400)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(res.body.message).toContain('Address is required');
        });
    });

    it('should return 400 when address is empty string', () => {
      return request(app.getHttpServer())
        .post('/get_path')
        .send({ address: '' })
        .expect(400)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(res.body.message).toContain('Address is required');
        });
    });

    it('should return 400 when address is null', () => {
      return request(app.getHttpServer())
        .post('/get_path')
        .send({ address: null })
        .expect(400);
    });

    it('should return 400 when address has invalid format', () => {
      return request(app.getHttpServer())
        .post('/get_path')
        .send({ address: invalidTokenAddress })
        .expect(400)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(res.body.message).toContain('Invalid Starknet address format');
        });
    });

    it('should return 400 when address does not start with 0x', () => {
      return request(app.getHttpServer())
        .post('/get_path')
        .send({ address: '1234567890abcdef' })
        .expect(400)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(res.body.message).toContain('Invalid Starknet address format');
        });
    });

    it('should return 400 when address has invalid hex characters', () => {
      return request(app.getHttpServer())
        .post('/get_path')
        .send({ address: '0x123g4567890abcdef' })
        .expect(400)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(res.body.message).toContain('Invalid Starknet address format');
        });
    });

    it('should return 400 when MCP service fails', async () => {
      const errorMessage = 'Failed to connect to MCP server';
      jest
        .spyOn(mcpAgentService, 'findBestYieldPath')
        .mockRejectedValue(new Error(errorMessage));

      return request(app.getHttpServer())
        .post('/get_path')
        .send({ address: validTokenAddress, amount: validAmount })
        .expect(400)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(res.body.message).toContain(
            'Failed to find optimal yield path',
          );
          expect(res.body.message).toContain(errorMessage);
        });
    });

    it('should handle very long address (max 64 hex chars)', () => {
      const longValidAddress = '0x' + 'a'.repeat(64);

      jest
        .spyOn(mcpAgentService, 'findBestYieldPath')
        .mockResolvedValue(mockYieldPathResult);

      return request(app.getHttpServer())
        .post('/get_path')
        .send({ address: longValidAddress, amount: validAmount })
        .expect(200);
    });

    it('should reject address longer than 64 hex characters', () => {
      const tooLongAddress = '0x' + 'a'.repeat(65);

      return request(app.getHttpServer())
        .post('/get_path')
        .send({ address: tooLongAddress })
        .expect(400)
        .expect((res) => {
          expect(res.body).toHaveProperty('message');
          expect(res.body.message).toContain('Invalid Starknet address format');
        });
    });

    it('should handle short valid address (min 1 hex char)', () => {
      const shortValidAddress = '0xa';

      jest
        .spyOn(mcpAgentService, 'findBestYieldPath')
        .mockResolvedValue(mockYieldPathResult);

      return request(app.getHttpServer())
        .post('/get_path')
        .send({ address: shortValidAddress, amount: validAmount })
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
        });
    });
  });

  describe('POST /get_path - Response structure', () => {
    it('should return properly structured response with all required fields', async () => {
      jest
        .spyOn(mcpAgentService, 'findBestYieldPath')
        .mockResolvedValue(mockYieldPathResult);

      return request(app.getHttpServer())
        .post('/get_path')
        .send({ address: validTokenAddress, amount: validAmount })
        .expect(200)
        .expect((res) => {
          // Top level structure
          expect(res.body).toHaveProperty('success');
          expect(res.body).toHaveProperty('tokenAddress');
          expect(res.body).toHaveProperty('result');

          // Result structure
          const result = res.body.result;
          expect(result).toHaveProperty('yield');
          expect(result).toHaveProperty('routes');
          expect(result.routes).toBeInstanceOf(Array);

          // Yield structure
          expect(result.yield).toHaveProperty('protocol');
          expect(result.yield).toHaveProperty('apy_pct');
          expect(result.yield).toHaveProperty('deposit_token');
          expect(result.yield).toHaveProperty('source');

          // Routes structure
          if (result.routes.length > 0) {
            const route = result.routes[0];
            expect(route).toHaveProperty('from_token');
            expect(route).toHaveProperty('to_token');
            expect(route).toHaveProperty('amount_in');

            // Type checks
            expect(typeof route.amount_in).toBe('string');
            expect(typeof route.from_token.address).toBe('string');
            expect(typeof route.to_token.address).toBe('string');
          }
          // Type checks
          expect(typeof result.yield.apy_pct).toBe('number');
        });
    });
  });
});
