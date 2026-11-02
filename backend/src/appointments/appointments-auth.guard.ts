import {
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { canSwitchShop } from '../auth/role-capabilities';
import { PrismaService } from '../common/prisma/prisma.service';

const STREAM_AUTH = 'appointments:stream-auth';
export const StreamAuth = () => SetMetadata(STREAM_AUTH, true);

@Injectable()
export class AppointmentsAuthGuard extends JwtAuthGuard {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!Reflect.getMetadata(STREAM_AUTH, context.getHandler())) {
      return super.canActivate(context) as Promise<boolean>;
    }
    const request = context.switchToHttp().getRequest<Request>();
    try {
      const token = request.query.accessToken;
      if (typeof token !== 'string' || !token) throw new Error('Missing token');
      const payload = await this.jwt.verifyAsync<{
        sub?: unknown;
        uv?: unknown;
        activeShopId?: unknown;
      }>(token, {
        secret: this.config.get<string>(
          'JWT_ACCESS_SECRET',
          'dev-access-secret',
        ),
      });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.uv !== 'number' ||
        typeof payload.activeShopId !== 'string' ||
        !payload.activeShopId
      ) {
        throw new Error('Invalid session');
      }
      const user = await this.prisma.user.findFirst({
        where: { id: payload.sub, status: UserStatus.ACTIVE, deletedAt: null },
        select: {
          id: true,
          username: true,
          role: true,
          shopId: true,
          updatedAt: true,
        },
      });
      if (
        !user ||
        user.updatedAt.getTime() !== payload.uv ||
        (!canSwitchShop(user.role) && user.shopId !== payload.activeShopId) ||
        !(await this.prisma.shop.findUnique({
          where: { id: payload.activeShopId },
          select: { id: true },
        }))
      ) {
        throw new Error('Invalid session');
      }
      request.user = {
        sub: user.id,
        username: user.username,
        role: user.role,
        activeShopId: payload.activeShopId,
      };
      return true;
    } catch {
      // Never include the query token (or verifier error) in logs/responses.
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
