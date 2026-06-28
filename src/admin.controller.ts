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
import { randomUUID, createHash } from 'node:crypto';
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

  /**
   * Генерация токена сессии на основе SHA-256 хэша пароля из .env
   */
  private getSessionHash(): string {
    const adminPassword =
      this.configService.get<string>('ADMIN_PASSWORD') || '12345';
    return createHash('sha256').update(adminPassword).digest('hex');
  }

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
  async getLogs(@Query('filter') filter?: string) {
    const logs = await this.adminService.getChatLogs(filter);
    return {
      logs,
      activeTab: 'logs',
      currentFilter: filter || 'all',
    };
  }

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

  @Get('users/:id')
  @UseGuards(AdminGuard)
  @Render('user-detail')
  async getUserDetail(@Param('id') id: string) {
    const user = await this.adminService.getUserById(id);
    const logs = await this.adminService.getUserChatLogs(id);
    return {
      user,
      logs,
      activeTab: 'users',
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
      const sessionToken = this.getSessionHash();
      res.cookie('admin_session', sessionToken, {
        httpOnly: true, // Исключает доступ к куке через JS
        maxAge: 24 * 60 * 60 * 1000, // 1 день
        sameSite: 'strict', // Защита от CSRF
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

  /**
   * Безопасное добавление статьи через параметризованный $executeRaw
   */
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

      await this.prismaService.$executeRaw`
        INSERT INTO "DocumentChunk" (id, content, source, embedding, "createdAt") 
        VALUES (${id}, ${content}, ${source}, ${vectorString}::vector, NOW())
      `;
      console.log(`[AdminController] Успешно добавлена статья: "${source}"`);
    } catch (error) {
      console.error(
        '[AdminController] Ошибка при ручной загрузке документа:',
        error,
      );
    }

    return res.redirect('/admin/documents');
  }

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

  @Get('documents/:id/edit')
  @UseGuards(AdminGuard)
  @Render('edit-document')
  async getEditPage(@Param('id') id: string) {
    const doc = await this.adminService.getDocumentById(id);
    return {
      doc,
      activeTab: 'documents',
    };
  }

  /**
   * Безопасное обновление статьи через параметризованный $executeRaw
   */
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
      const embeddingArray = await this.aiService.getEmbedding(content);
      const vectorString = `[${embeddingArray.join(',')}]`;

      await this.prismaService.$executeRaw`
        UPDATE "DocumentChunk" 
        SET content = ${content}, source = ${source}, embedding = ${vectorString}::vector 
        WHERE id = ${id}
      `;
      console.log(`[AdminController] Успешно обновлена статья: "${source}"`);
    } catch (error) {
      console.error(
        '[AdminController] Ошибка при обновлении документа:',
        error,
      );
    }

    return res.redirect('/admin/documents');
  }
}
