import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';
import { get, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { Observable } from 'rxjs';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PrismaService } from '../common/prisma/prisma.service';
import { ShopContextInterceptor } from '../common/shop-context/shop-context.interceptor';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AppointmentsEventsService } from './appointments-events.service';
import { AppointmentsAuthGuard } from './appointments-auth.guard';
import { GlobalExceptionFilter } from '../common/filters/global-exception.filter';
import { RequestLoggingInterceptor } from '../common/interceptors/request-logging.interceptor';

describe('Appointments HTTP authentication (in-memory stores)', () => {
  let app: INestApplication;
  let port: number;
  let subscriptions = 0;
  let logSpy: jest.SpyInstance;
  const version = new Date('2026-01-01');
  const verifyAsync = jest.fn((token: string) => {
    if (['invalid', 'expired'].includes(token)) throw new Error('Rejected JWT');
    return Promise.resolve({
      sub: token,
      uv: token === 'revoked' ? 0 : version.getTime(),
      role: UserRole.MANAGER, // Never trust a stale/forged role over the user row.
      activeShopId:
        token === 'missing-shop'
          ? 'missing'
          : token === 'other-shop'
            ? 'shop-b'
            : 'shop-a',
    });
  });
  const findFirst = jest.fn(
    (args: { where: { id: string; status: UserStatus; deletedAt: null } }) => {
      if (['disabled', 'deleted'].includes(args.where.id)) return null;
      return {
        id: args.where.id,
        username: 'login',
        role: UserRole.EMPLOYEE,
        shopId: 'shop-a',
        updatedAt: version,
      };
    },
  );
  const listAppointments = jest.fn(() => [{ id: 'appointment-1' }]);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [AppointmentsController],
      providers: [
        AppointmentsAuthGuard,
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_ACCESS_SECRET: 'test-secret' }),
        },
        { provide: JwtService, useValue: { verifyAsync } },
        {
          provide: PrismaService,
          useValue: {
            user: { findFirst },
            shop: {
              findUnique: jest.fn(({ where }: { where: { id: string } }) =>
                where.id === 'missing' ? null : { id: where.id },
              ),
            },
          },
        },
        { provide: AppointmentsService, useValue: { listAppointments } },
        {
          provide: AppointmentsEventsService,
          useValue: {
            watchAppointmentsChanged: () =>
              new Observable((subscriber) => {
                subscriptions++;
                subscriber.next({
                  type: 'appointments.changed',
                  timestamp: '2026-01-01T00:00:00Z',
                  actorId: 'private-actor',
                });
                return () => subscriptions--;
              }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(
      new RequestLoggingInterceptor(),
      new ShopContextInterceptor(new Reflector()),
    );
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as Server;
    const address = server.address();
    port = (address as AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
    expect(subscriptions).toBe(0);
    logSpy.mockRestore();
  });

  const read = (path: string, method = 'GET', token?: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = get(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
        (response) => {
          let body = '';
          response.on('data', (chunk: Buffer) => {
            body += chunk.toString();
            if (response.statusCode === 200 && body.includes('data:')) {
              response.destroy();
              request.destroy();
              resolve({ status: response.statusCode, body });
            }
          });
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, body }),
          );
        },
      );
      request.on('error', reject);
      request.setTimeout(3000, () =>
        request.destroy(new Error('HTTP timeout')),
      );
    });

  it('connects with query JWT, preserves event projection and cleans up subscription', async () => {
    const response = await read('/appointments/stream?accessToken=valid');
    expect(response.status).toBe(200);
    expect(response.body).toContain('event: appointments.changed');
    expect(response.body).toContain('"timestamp":"2026-01-01T00:00:00Z"');
    expect(response.body).not.toContain('private-actor');
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('accessToken');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^GET \/appointments\/stream 200 \d+ms$/),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(subscriptions).toBe(0);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'valid', status: UserStatus.ACTIVE, deletedAt: null },
      }),
    );
  });

  it.each([
    'invalid',
    'expired',
    'revoked',
    'disabled',
    'deleted',
    'other-shop',
    'missing-shop',
  ])('rejects %s stream sessions without exposing the token', async (token) => {
    const response = await read(`/appointments/stream?accessToken=${token}`);
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({
      success: false,
      statusCode: 401,
      message: 'Invalid access token',
      path: '/appointments/stream',
    });
    expect(response.body).not.toContain('accessToken');
  });

  it.each([
    '/appointments',
    '/appointments?accessToken=valid',
    '/appointments/customer-lookup?phone=123',
    '/appointments/stream',
  ])('does not open unauthenticated route %s', async (path) => {
    expect((await read(path)).status).toBe(401);
    expect(listAppointments).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', '/appointments'],
    ['PATCH', '/appointments/id'],
    ['DELETE', '/appointments/id'],
    ['POST', '/appointments/id/cancel'],
    ['POST', '/appointments/id/move'],
  ])('keeps %s %s protected', async (method, path) => {
    expect((await read(path, method)).status).toBe(401);
  });

  it('ordinary header JWT still reaches the guarded endpoint with its HTTP body', async () => {
    const token = new JwtService().sign(
      {
        sub: 'valid-header',
        uv: version.getTime(),
        activeShopId: 'shop-a',
      },
      { secret: 'test-secret', expiresIn: '1m' },
    );
    const response = await read('/appointments', 'GET', token);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual([{ id: 'appointment-1' }]);
  });

  it('redacts query credentials from unhandled-error logs and HTTP response paths', async () => {
    const errors = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      listAppointments.mockImplementationOnce(() => {
        throw new Error('test failure');
      });
      const token = new JwtService().sign(
        {
          sub: 'valid-header',
          uv: version.getTime(),
          activeShopId: 'shop-a',
        },
        { secret: 'test-secret', expiresIn: '1m' },
      );
      const response = await read(
        '/appointments?accessToken=never-log-this-secret',
        'GET',
        token,
      );
      expect(response.status).toBe(500);
      expect(JSON.parse(response.body)).toMatchObject({
        success: false,
        statusCode: 500,
        path: '/appointments',
        message: 'Internal server error',
      });
      expect(errors).toHaveBeenCalled();
      expect(JSON.stringify(errors.mock.calls)).not.toContain(
        'never-log-this-secret',
      );
      expect(response.body).not.toContain('never-log-this-secret');
    } finally {
      errors.mockRestore();
    }
  });
});
