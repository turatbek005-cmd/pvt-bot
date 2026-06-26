import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import cookieParser from 'cookie-parser'; // Чистый импорт по стандартам esModuleInterop

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(cookieParser()); // Подключаем куки-парсер

  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  app.setViewEngine('ejs');

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`[NestJS] Сервер успешно запущен на порту: ${port}`);
  console.log(
    `[NestJS] Админ-панель будет доступна по адресу: http://localhost:${port}/admin`,
  );
}
void bootstrap();
