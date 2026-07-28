import { Module } from '@nestjs/common';
import { DefaultAdminSeed } from './default-admin.seed';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [DefaultAdminSeed],
  exports: [DefaultAdminSeed],
})
export class SeedModule {}
