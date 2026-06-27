import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  Param,
  Query,
  Render,
  UseGuards,
} from '@nestjs/common';
import * as express from 'express';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { AiService } from './ai.service';
import { PrismaService } from './prisma.service';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly configService: ConfigService,
    private readonly aiService: AiService,
    private readonly prismaService: PrismaService,
  ) {}

  // 1. Показ главной страницы статистики (Dashboard)
  @Get()
  @UseGuards(AdminGuard)
  @Render('index')
  async getDashboard() {
    const stats = await this.adminService.getDashboardStats();
    return {
      stats,
      activeTab: 'dashboard',
    };
  }

  // 2. Показ логов переписок с поддержкой фильтрации (?filter=unhandled / user / bot)
  @Get('logs')
  @UseGuards(AdminGuard)
  @Render('logs')
  async getLogs(@Query('filter') filter?: string) {
    const logs = await this.adminService.getChatLogs(filter);
    return {
      logs,
      activeTab: 'logs',
      currentFilter: filter || 'all', // Передаем активный фильтр в шаблон
    };
  }

  // 3. Показ списка пользователей Telegram
  @Get('users')
  @UseGuards(AdminGuard)
  @Render('users')
  async getUsers() {
    const users = await this.adminService.getUsersList();
    return {
      users,
      activeTab: 'users',
    };
  }

  // 4. Показ детального диалога конкретного пользователя по ID
  @Get('users/:id')
  @UseGuards(AdminGuard)
  @Render('user-detail') //views/user-detail.ejs
  async getUserDetail(@Param('id') id: string) {
    const user = await this.adminService.getUserById(id);
    const logs = await this.adminService.getUserChatLogs(id);
    return {
      user,
      logs,
      activeTab: 'users',
    };
  }

  // 5. Показ загруженных документов
  @Get('documents')
  @UseGuards(AdminGuard)
  @Render('documents')
  async getDocuments() {
    const docs = await this.adminService.getUploadedDocuments();
    return {
      docs,
      activeTab: 'documents',
    };
  }

  // 6. Показ страницы входа
  @Get('login')
  @Render('login')
  getLoginPage() {
    return { error: null };
  }

  // 7. Обработка отправки формы входа
  @Post('login')
  login(@Body('password') password: string, @Res() res: express.Response) {
    const adminPassword =
      this.configService.get<string>('ADMIN_PASSWORD') || '12345';

    if (password === adminPassword) {
      res.cookie('admin_session', 'authorized', {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'strict',
      });
      return res.redirect('/admin');
    }

    return res.render('login', { error: 'Неверный пароль!' });
  }

  // 8. Выход из панели
  @Get('logout')
  logout(@Res() res: express.Response) {
    res.clearCookie('admin_session');
    return res.redirect('/admin/login');
  }

  // 9. Загрузка и векторизация новой статьи через админку
  @Post('documents')
  @UseGuards(AdminGuard)
  async uploadDocument(
    @Body('source') source: string,
    @Body('content') content: string,
    @Res() res: express.Response,
  ) {
    if (!source || !content) {
      return res.redirect('/admin/documents');
    }

    try {
      const embeddingArray = await this.aiService.getEmbedding(content);
      const vectorString = `[${embeddingArray.join(',')}]`;
      const id = randomUUID();

      await this.prismaService.$executeRawUnsafe(
        `INSERT INTO "DocumentChunk" (id, content, source, embedding, "createdAt") VALUES ($1, $2, $3, $4::vector, NOW())`,
        id,
        content,
        source,
        vectorString,
      );
      console.log(
        `[AdminController] Успешно добавлена и векторизована новая статья: "${source}"`,
      );
    } catch (error) {
      console.error(
        '[AdminController] Ошибка при ручной загрузке документа:',
        error,
      );
    }

    return res.redirect('/admin/documents');
  }

  // 10. Удаление документа по его ID
  @Post('documents/:id/delete')
  @UseGuards(AdminGuard)
  async deleteDocument(@Param('id') id: string, @Res() res: express.Response) {
    try {
      await this.adminService.deleteDocument(id);
      console.log(`[AdminController] Успешно удалена статья с ID: ${id}`);
    } catch (error) {
      console.error('[AdminController] Ошибка при удалении документа:', error);
    }
    return res.redirect('/admin/documents');
  }

  // 11. Показ страницы редактирования конкретной статьи
  @Get('documents/:id/edit')
  @UseGuards(AdminGuard)
  @Render('edit-document') // views/edit-document.ejs
  async getEditPage(@Param('id') id: string) {
    const doc = await this.adminService.getDocumentById(id);
    return {
      doc,
      activeTab: 'documents',
    };
  }

  // 12. Сохранение измененного документа (Перегенерация вектора на лету!)
  @Post('documents/:id/edit')
  @UseGuards(AdminGuard)
  async updateDocument(
    @Param('id') id: string,
    @Body('source') source: string,
    @Body('content') content: string,
    @Res() res: express.Response,
  ) {
    if (!source || !content) {
      return res.redirect(`/admin/documents/${id}/edit`);
    }

    try {
      // Генерируем новый вектор для обновленного текста статьи!
      const embeddingArray = await this.aiService.getEmbedding(content);
      const vectorString = `[${embeddingArray.join(',')}]`;

      // Обновляем текст, источник и новый вектор в PostgreSQL
      await this.prismaService.$executeRawUnsafe(
        `UPDATE "DocumentChunk" SET content = $1, source = $2, embedding = $3::vector WHERE id = $4`,
        content,
        source,
        vectorString,
        id,
      );
      console.log(
        `[AdminController] Успешно обновлена и векторизована статья: "${source}"`,
      );
    } catch (error) {
      console.error(
        '[AdminController] Ошибка при обновлении документа:',
        error,
      );
    }

    return res.redirect('/admin/documents');
  }
}
