import {
  Controller,
  Get,
  Post,
  Body,
  Logger,
  BadRequestException,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppService } from '../services/app.service.js';
import { ApiSecretGuard } from '../guards/api-secret.guard.js';

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
  @UseGuards(ApiSecretGuard)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
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
