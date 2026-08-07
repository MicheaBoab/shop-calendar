import {
	Body,
	Controller,
	Delete,
	Get,
	MessageEvent,
	Param,
	Patch,
	Post,
	Query,
	Req,
	Sse,
	UnauthorizedException,
	UseGuards,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { MoveAppointmentDto } from './dto/move-appointment.dto';
import { ListAppointmentsDto } from './dto/list-appointments.dto';
import { DeleteAppointmentDto } from './dto/delete-appointment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppointmentsEventsService } from './appointments-events.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';

type AuthTokenPayload = {
	sub: string;
	username: string;
	role: string;
	uv: number;
};

type AuthenticatedRequest = Request & {
	user: {
		sub: string;
		username: string;
		role: UserRole;
	};
};

@Controller('appointments')
export class AppointmentsController {
	constructor(
		private readonly appointmentsService: AppointmentsService,
		private readonly appointmentsEventsService: AppointmentsEventsService,
		private readonly jwtService: JwtService,
		private readonly configService: ConfigService,
		private readonly prismaService: PrismaService,
	) {}

	@Get()
	@UseGuards(JwtAuthGuard)
	listAppointments(@Query() query: ListAppointmentsDto) {
		return this.appointmentsService.listAppointments(query);
	}

	@Post()
	@UseGuards(JwtAuthGuard)
	createAppointment(@Body() dto: CreateAppointmentDto, @Req() req: AuthenticatedRequest) {
		return this.appointmentsService.createAppointment({
			...dto,
			createdById: req.user.sub,
			userRole: req.user.role,
		});
	}

	@Patch(':id')
	@UseGuards(JwtAuthGuard)
	updateAppointment(
		@Param('id') id: string,
		@Body() dto: UpdateAppointmentDto,
		@Req() req: AuthenticatedRequest,
	) {
		return this.appointmentsService.updateAppointment(id, {
			...dto,
			updatedById: req.user.sub,
			userRole: req.user.role,
		});
	}

	@Delete(':id')
	@UseGuards(JwtAuthGuard)
	deleteAppointment(
		@Param('id') id: string,
		@Body() _dto: DeleteAppointmentDto,
		@Req() req: AuthenticatedRequest,
	) {
		if (req.user.role === UserRole.ADMIN) {
			return this.appointmentsService.deleteAppointment(id, req.user.sub);
		}

		return this.appointmentsService.cancelAppointment(id, req.user.sub);
	}

	@Post(':id/move')
	@UseGuards(JwtAuthGuard)
	moveAppointment(
		@Param('id') id: string,
		@Body() dto: MoveAppointmentDto,
		@Req() req: AuthenticatedRequest,
	) {
		return this.appointmentsService.moveAppointment(id, {
			...dto,
			updatedById: req.user.sub,
			userRole: req.user.role,
		});
	}

	@Sse('stream')
	async streamAppointmentsChanged(
		@Query('accessToken') accessToken?: string,
	): Promise<Observable<MessageEvent>> {
		if (!accessToken) {
			throw new UnauthorizedException('Missing access token');
		}

		try {
			const payload = await this.jwtService.verifyAsync<Partial<AuthTokenPayload>>(accessToken, {
				secret: this.configService.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret'),
			});

			if (!payload?.sub || typeof payload.uv !== 'number') {
				throw new UnauthorizedException('Invalid access token');
			}

			const user = await this.prismaService.user.findFirst({
				where: {
					id: payload.sub,
					status: UserStatus.ACTIVE,
					deletedAt: null,
				},
				select: {
					updatedAt: true,
				},
			});

			if (!user || user.updatedAt.getTime() !== payload.uv) {
				throw new UnauthorizedException('Session expired');
			}
		} catch {
			throw new UnauthorizedException('Invalid access token');
		}

		return this.appointmentsEventsService.watchAppointmentsChanged().pipe(
			map((event) => ({
				type: event.type,
				data: {
					type: event.type,
					timestamp: event.timestamp,
				},
			})),
		);
	}
}
