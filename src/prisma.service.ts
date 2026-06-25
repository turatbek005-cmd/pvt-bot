import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // Получаем строку подключения к нашей БД
    const connectionString =
      process.env.DATABASE_URL ||
      'postgresql://pvt_admin:pvt_secure_password_2026@127.0.0.1:5435/pvt_database?schema=public';

    // Создаем пул подключений pg (PostgreSQL)
    const pool = new Pool({ connectionString });

    // Создаем адаптер для Prisma 7
    const adapter = new PrismaPg(pool);

    // Передаем адаптер в родительский класс PrismaClient
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
