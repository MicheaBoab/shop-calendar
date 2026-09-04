import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { shopContextStorage } from './shop-context';
import { SKIP_SHOP_SCOPE_KEY } from './skip-shop-scope.decorator';

type RequestWithUser = {
  user?: {
    sub: string;
    role: string;
    activeShopId?: string;
  };
};

// Populates an AsyncLocalStorage-backed shop context for every request that carries an
// authenticated user with an active shop selection, so downstream services (and the Prisma
// shop-scope extension) can read the current shopId without threading it through every call.
@Injectable()
export class ShopContextInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    const skipShopScope = this.reflector.getAllAndOverride<boolean>(SKIP_SHOP_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!user || skipShopScope) {
      return next.handle();
    }

    if (!user.activeShopId) {
      throw new BadRequestException('No shop selected. Call /auth/select-shop before using this endpoint.');
    }

    const store = { shopId: user.activeShopId, userId: user.sub, role: user.role };

    return new Observable((subscriber) => {
      shopContextStorage.run(store, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
