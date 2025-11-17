import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiSecretGuard implements CanActivate {
  private readonly logger = new Logger(ApiSecretGuard.name);

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const secret =
      request.headers['x-api-secret'] ||
      request.headers['authorization']?.replace('Bearer ', '');

    const validSecret = this.configService.get<string>('API_SECRET');

    if (!validSecret) {
      this.logger.error('API_SECRET is not defined in environment variables');
      throw new UnauthorizedException('Server configuration error');
    }

    if (!secret || secret !== validSecret) {
      throw new UnauthorizedException('Unauthorized');
    }

    return true;
  }
}

