import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(cookieParser());

  // Используем process.cwd() для точной привязки к корню проекта на любом компьютере!
  app.useStaticAssets(join(process.cwd(), 'public'));
  app.setBaseViewsDir(join(process.cwd(), 'views'));
  app.setViewEngine('ejs');

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`[NestJS] Сервер успешно запущен на порту: ${port}`);
  console.log(
    `[NestJS] Админ-панель будет доступна по адресу: http://localhost:${port}/admin`,
  );
}
void bootstrap();
