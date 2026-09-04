import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { SelectShopDto } from './dto/select-shop.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SkipShopScope } from '../common/shop-context/skip-shop-scope.decorator';

type AuthenticatedRequest = Request & { user: { sub: string } };

@Controller('auth')
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	@Post('login')
	login(@Body() dto: LoginDto) {
		return this.authService.login(dto);
	}

	@Post('select-shop')
	@UseGuards(JwtAuthGuard)
	@SkipShopScope()
	selectShop(@Body() dto: SelectShopDto, @Req() req: AuthenticatedRequest) {
		return this.authService.selectShop(req.user.sub, dto.shopId);
	}

	@Post('refresh')
	refresh(@Body() dto: RefreshTokenDto) {
		return this.authService.refresh(dto.refreshToken);
	}

	@Post('logout')
	@UseGuards(JwtAuthGuard)
	@SkipShopScope()
	logout() {
		return this.authService.logout();
	}
}
