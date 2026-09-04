import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserRole, UserStatus } from '@prisma/client';
import { StringValue } from 'ms';
import { PrismaService } from '../common/prisma/prisma.service';
import { ShopScopeService } from '../shops/shop-scope.service';
import { LoginDto } from './dto/login.dto';

type AuthTokenPayload = {
	sub: string;
	username: string;
	role: string;
	uv: number;
	shopId: string;
	activeShopId?: string;
};

@Injectable()
export class AuthService {
	constructor(
		private readonly prismaService: PrismaService,
		private readonly jwtService: JwtService,
		private readonly configService: ConfigService,
		private readonly shopScopeService: ShopScopeService,
	) {}

	async login(dto: LoginDto) {
		const user = await this.prismaService.user.findFirst({
			where: {
				username: dto.username,
				status: UserStatus.ACTIVE,
				deletedAt: null,
			},
		});

		if (!user) {
			throw new UnauthorizedException('Invalid username or password');
		}

		const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
		if (!passwordMatches) {
			throw new UnauthorizedException('Invalid username or password');
		}

		// Employees always operate in their own shop; admins must explicitly select one.
		const activeShopId = user.role === UserRole.ADMIN ? undefined : user.shopId;

		return {
			...this.buildTokenPair({
				sub: user.id,
				username: user.username,
				role: user.role,
				uv: this.getUserAuthVersion(user.updatedAt),
				shopId: user.shopId,
				activeShopId,
			}),
			user: {
				id: user.id,
				username: user.username,
				displayName: user.displayName,
				role: user.role,
				status: user.status,
			},
			needsShopSelection: !activeShopId,
			activeShopId: activeShopId ?? null,
		};
	}

	async selectShop(userId: string, shopId: string) {
		const user = await this.prismaService.user.findFirst({
			where: { id: userId, status: UserStatus.ACTIVE, deletedAt: null },
		});

		if (!user) {
			throw new UnauthorizedException('User is inactive or does not exist');
		}

		this.shopScopeService.assertAccess({ role: user.role, shopId: user.shopId }, shopId);
		await this.shopScopeService.assertShopExists(shopId);

		return {
			...this.buildTokenPair({
				sub: user.id,
				username: user.username,
				role: user.role,
				uv: this.getUserAuthVersion(user.updatedAt),
				shopId: user.shopId,
				activeShopId: shopId,
			}),
			user: {
				id: user.id,
				username: user.username,
				displayName: user.displayName,
				role: user.role,
				status: user.status,
			},
			activeShopId: shopId,
		};
	}

	async refresh(refreshToken: string) {
		try {
			const payload = await this.jwtService.verifyAsync<Partial<AuthTokenPayload>>(refreshToken, {
				secret: this.configService.get<string>('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
			});

			if (!this.isValidTokenPayload(payload)) {
				throw new UnauthorizedException('Invalid refresh token');
			}

			const user = await this.prismaService.user.findFirst({
				where: { id: payload.sub, status: UserStatus.ACTIVE, deletedAt: null },
			});

			if (!user) {
				throw new UnauthorizedException('User is inactive or does not exist');
			}

			if (payload.uv !== this.getUserAuthVersion(user.updatedAt)) {
				throw new UnauthorizedException('Session expired');
			}

			// Employees are always pinned to their own shop; admins keep whatever shop was
			// active on the token being refreshed (if it's still valid for them).
			let activeShopId = user.role === UserRole.ADMIN ? payload.activeShopId : user.shopId;
			if (activeShopId) {
				try {
					this.shopScopeService.assertAccess({ role: user.role, shopId: user.shopId }, activeShopId);
				} catch {
					activeShopId = undefined;
				}
			}

			return {
				...this.buildTokenPair({
					sub: user.id,
					username: user.username,
					role: user.role,
					uv: this.getUserAuthVersion(user.updatedAt),
					shopId: user.shopId,
					activeShopId,
				}),
				user: {
					id: user.id,
					username: user.username,
					displayName: user.displayName,
					role: user.role,
					status: user.status,
				},
				needsShopSelection: !activeShopId,
				activeShopId: activeShopId ?? null,
			};
		} catch {
			throw new UnauthorizedException('Invalid refresh token');
		}
	}

	logout() {
		return { success: true };
	}

	private buildTokenPair(payload: AuthTokenPayload) {
		const accessToken = this.jwtService.sign(payload, {
			secret: this.configService.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret'),
			expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN', '15m') as StringValue,
		});

		const refreshToken = this.jwtService.sign(payload, {
			secret: this.configService.get<string>('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
			expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d') as StringValue,
		});

		return {
			accessToken,
			refreshToken,
			tokenType: 'Bearer',
		};
	}

	private getUserAuthVersion(updatedAt: Date) {
		return updatedAt.getTime();
	}

	private isValidTokenPayload(payload: Partial<AuthTokenPayload> | null | undefined): payload is AuthTokenPayload {
		return Boolean(
			payload
			&& typeof payload.sub === 'string'
			&& typeof payload.username === 'string'
			&& typeof payload.role === 'string'
			&& typeof payload.uv === 'number'
			&& typeof payload.shopId === 'string',
		);
	}
}
