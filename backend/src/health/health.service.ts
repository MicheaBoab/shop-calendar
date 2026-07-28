import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
	getHealth() {
		return {
			status: 'ok',
			timezone: process.env.APP_TIMEZONE ?? 'America/Chicago',
			timestamp: new Date().toISOString(),
		};
	}
}
