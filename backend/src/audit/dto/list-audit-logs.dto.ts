import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListAuditLogsDto {
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@IsOptional()
	page = 1;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(200)
	@IsOptional()
	limit = 50;

	@Transform(({ value }) => {
		if (typeof value !== 'string') {
			return value;
		}

		const normalized = value.trim().toLowerCase();
		if (normalized === 'appointment' || normalized === 'user') {
			return normalized;
		}

		return value;
	})
	@IsIn(['appointment', 'user'])
	@IsOptional()
	entityType?: 'appointment' | 'user';
}