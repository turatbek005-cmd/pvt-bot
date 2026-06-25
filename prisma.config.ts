import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Если переменная окружения пустая (undefined), берем резервную строку подключения
    url:
      process.env.DATABASE_URL ||
      'postgresql://pvt_admin:pvt_secure_password_2026@127.0.0.1:5435/pvt_database?schema=public',
  },
});
