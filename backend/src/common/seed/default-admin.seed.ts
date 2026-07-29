import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole, UserStatus } from '@prisma/client';

@Injectable()
export class DefaultAdminSeed {
  constructor(private readonly prismaService: PrismaService) {}

  async run() {
    const username = process.env.DEFAULT_ADMIN_USERNAME ?? 'admin';

    const existing = await this.prismaService.user.findFirst({
      where: { username, deletedAt: null },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
      },
    });

    if (existing) {
      return existing;
    }

    const password = process.env.DEFAULT_ADMIN_PASSWORD ?? 'admin123';
    const passwordHash = await bcrypt.hash(password, 10);

    return this.prismaService.user.create({
      data: {
        username,
        passwordHash,
        displayName: 'Shop Admin',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
      },
    });
  }
}
