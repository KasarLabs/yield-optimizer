import {
  Controller,
  Get,
  Post,
  Body,
  Logger,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import { AppService } from '../services/app.service.js';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private readonly appService: AppService) {}

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  @Post('get_path')
  @HttpCode(200)
  async getPath(
    @Body('address') address: string,
    @Body('amount') amount: string,
  ) {
    if (!address) {
      throw new BadRequestException('Address is required');
    }

    if (!amount) {
      throw new BadRequestException('Amount is required');
    }

    if (!this.appService.isValidStarknetAddress(address)) {
      throw new BadRequestException('Invalid Starknet address format');
    }

    this.logger.log(
      `Finding optimal yield path for token: ${address} with amount: ${amount}`,
    );

    try {
      const yieldPath = await this.appService.findOptimalYieldPath(
        address,
        amount,
      );

      return {
        success: true,
        tokenAddress: address,
        amount,
        result: yieldPath,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Error finding yield path: ${err.message}`, err.stack);
      throw new BadRequestException(
        `Failed to find optimal yield path: ${err.message}`,
      );
    }
  }
}
