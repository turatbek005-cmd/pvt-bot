import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  Render,
  UseGuards,
} from '@nestjs/common';
import * as express from 'express'; // Импортируем express как пространство имен для избежания TS1272
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

  @Get('logs')
  @UseGuards(AdminGuard)
  @Render('logs')
  async getLogs() {
    const logs = await this.adminService.getChatLogs();
    return {
      logs,
      activeTab: 'logs',
    };
  }

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
  @Get('login')
  @Render('login')
  getLoginPage() {
    return { error: null };
  }
  @Post('login')
  login(@Body('password') password: string, @Res() res: express.Response) {
    const adminPassword =
      this.configService.get<string>('ADMIN_PASSWORD') || '12345';

    if (password === adminPassword) {
      // Устанавливаем куку авторизации с флагами безопасности
      res.cookie('admin_session', 'authorized', {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 1 день
        sameSite: 'strict',
      });
      return res.redirect('/admin');
    }

    return res.render('login', { error: 'Неверный пароль!' });
  }
  @Get('logout')
  logout(@Res() res: express.Response) {
    res.clearCookie('admin_session');
    return res.redirect('/admin/login');
  }
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
      // Генерируем ИИ-вектор для нового текста на лету!
      const embeddingArray = await this.aiService.getEmbedding(content);
      const vectorString = `[${embeddingArray.join(',')}]`;
      const id = randomUUID();

      // Сохраняем новую статью в PostgreSQL
      await this.prismaService.$executeRawUnsafe(
        `INSERT INTO "DocumentChunk" (id, content, source, embedding, "createdAt") VALUES ($1, $2, $3, $4::vector, NOW())`,
        id,
        content,
        source,
        vectorString,
      );

      console.log(`[AdminController] Успешно добавлена и векторизована новая статья:
       "${source}"`);
    } catch (error) {
      console.error(
        '[AdminController] Ошибка при ручной загрузке документа:',
        error,
      );
    }

    return res.redirect('/admin/documents');
  }
}
