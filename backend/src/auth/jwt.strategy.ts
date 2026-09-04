import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../common/prisma/prisma.service';

type AuthTokenPayload = {
  sub: string;
  username: string;
  role: string;
  uv: number;
  shopId: string;
  activeShopId?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService, private readonly prismaService: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret'),
    });
  }

  async validate(payload: AuthTokenPayload) {
    if (!payload || typeof payload.sub !== 'string' || typeof payload.uv !== 'number') {
      throw new UnauthorizedException('Invalid access token');
    }

    const user = await this.prismaService.user.findFirst({
      where: {
        id: payload.sub,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: {
        id: true,
        username: true,
        role: true,
        shopId: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User is inactive or does not exist');
    }

    if (user.updatedAt.getTime() !== payload.uv) {
      throw new UnauthorizedException('Session expired');
    }

    return {
      sub: user.id,
      username: user.username,
      role: user.role,
      uv: payload.uv,
      shopId: user.shopId,
      activeShopId: payload.activeShopId,
    };
  }
}