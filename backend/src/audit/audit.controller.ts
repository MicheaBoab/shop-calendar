import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from './audit.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
	constructor(private readonly auditService: AuditService) {}

	@Get('logs')
	@Roles(UserRole.ADMIN)
	listAuditLogs(@Query() query: ListAuditLogsDto) {
		return this.auditService.listAuditLogs(query);
	}
}