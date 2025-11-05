import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from '../app.controller';
import { AppService } from '../../services/app.service';
import { McpAgentService } from '../../services/mcp-agent.service';

describe('AppController', () => {
  let appController: AppController;
  let mockMcpAgentService: jest.Mocked<
    Pick<McpAgentService, 'findBestYieldPath'>
  >;

  beforeEach(async () => {
    mockMcpAgentService = {
      findBestYieldPath: jest.fn(),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: McpAgentService,
          useValue: mockMcpAgentService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return health status', () => {
      const result = appController.getHealth();
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('timestamp');
      expect(result.status).toBe('ok');
    });
  });
});
