import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserPasswordDto } from './dto/update-user-password.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

type AuthenticatedRequest = Request & {
	user: {
		sub: string;
		username: string;
		role: UserRole;
	};
};

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
	constructor(private readonly usersService: UsersService) {}

	@Get()
	listUsers() {
		return this.usersService.listUsers();
	}

	@Post()
	@Roles(UserRole.ADMIN)
	createUser(@Body() dto: CreateUserDto, @Req() req: AuthenticatedRequest) {
		return this.usersService.createUser(dto, req.user.sub);
	}

	@Patch(':id/status')
	@Roles(UserRole.ADMIN)
	updateUserStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto, @Req() req: AuthenticatedRequest) {
		return this.usersService.updateUserStatus(id, dto, req.user.sub);
	}

	@Patch(':id/password')
	@Roles(UserRole.ADMIN)
	updateUserPassword(@Param('id') id: string, @Body() dto: UpdateUserPasswordDto, @Req() req: AuthenticatedRequest) {
		return this.usersService.updateUserPassword(id, dto, req.user.sub);
	}

	@Delete(':id')
	@Roles(UserRole.ADMIN)
	removeUser(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
		return this.usersService.removeUser(id, req.user.sub);
	}
}
