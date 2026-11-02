import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { MoveAppointmentDto } from './dto/move-appointment.dto';
import { ListAppointmentsDto } from './dto/list-appointments.dto';
import { DeleteAppointmentDto } from './dto/delete-appointment.dto';
import { AppointmentsAuthGuard, StreamAuth } from './appointments-auth.guard';
import { AppointmentsEventsService } from './appointments-events.service';
import { canManageAppointments } from '../auth/role-capabilities';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

type AuthenticatedRequest = Request & {
  user: {
    sub: string;
    username: string;
    role: UserRole;
    displayName?: string;
  };
};

@Controller('appointments')
@UseGuards(AppointmentsAuthGuard, RolesGuard)
export class AppointmentsController {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly appointmentsEventsService: AppointmentsEventsService,
  ) {}

  @Get()
  listAppointments(@Query() query: ListAppointmentsDto) {
    return this.appointmentsService.listAppointments(query);
  }

  @Get('customer-lookup')
  findCustomerByPhone(@Query('phone') phone: string) {
    return this.appointmentsService.findCustomerByPhone(phone);
  }

  @Post()
  @Roles(
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.EMPLOYEE,
    UserRole.SHOP_ACCOUNT,
  )
  createAppointment(
    @Body() dto: CreateAppointmentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.appointmentsService.createAppointment({
      ...dto,
      createdById: req.user.sub,
      userRole: req.user.role,
    });
  }

  @Patch(':id')
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
  deleteAppointment(
    @Param('id') id: string,
    @Body() _dto: DeleteAppointmentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!canManageAppointments(req.user.role)) {
      throw new ForbiddenException(
        'DELETE /appointments/:id is reserved for soft deletion. Use POST /appointments/:id/cancel to cancel.',
      );
    }

    return this.appointmentsService.deleteAppointment(id, req.user.sub);
  }

  @Post(':id/cancel')
  cancelAppointment(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.appointmentsService.cancelAppointment(id, req.user.sub);
  }

  @Post(':id/move')
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
  @StreamAuth()
  streamAppointmentsChanged(): Observable<MessageEvent> {
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
