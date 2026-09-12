import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const translated = this.translateKnownPrismaError(exception);
    const resolvedException = translated ?? exception;

    const status =
      resolvedException instanceof HttpException
        ? resolvedException.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      resolvedException instanceof HttpException
        ? resolvedException.getResponse()
        : 'Internal server error';

    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : ((exceptionResponse as { message?: string | string[] }).message ??
          'Internal server error');

    if (!(resolvedException instanceof HttpException)) {
      const stack =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}: ${stack}`,
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      message,
    });
  }

  private translateKnownPrismaError(
    exception: unknown,
  ): HttpException | null {
    if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002'
    ) {
      return new ConflictException('Username already exists');
    }

    return null;
  }
}
