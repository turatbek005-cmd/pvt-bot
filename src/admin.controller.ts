import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  Render,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard'; // Импортируем защитника

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly configService: ConfigService, // Внедряем ConfigService для чтения пароля
  ) {}

  // 1. Показ главной страницы статистики (Защищен Guard-ом)
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

  // 2. Показ логов переписок (Защищен Guard-ом)
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

  // 3. Показ загруженных документов (Защищен Guard-ом)
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

  // 4. Показ страницы входа (Открыт для всех)
  @Get('login')
  @Render('login')
  getLoginPage() {
    return { error: null };
  }

  // 5. Обработка отправки формы входа (Открыт для всех)
  @Post('login')
  login(@Body('password') password: string, @Res() res: Response) {
    const adminPassword =
      this.configService.get<string>('ADMIN_PASSWORD') || '12345';

    if (password === adminPassword) {
      // Устанавливаем куку авторизации с флагами безопасности
      res.cookie('admin_session', 'authorized', {
        httpOnly: true, // Запрещает чтение куки из JavaScript (защита от XSS)
        maxAge: 24 * 60 * 60 * 1000, // Срок жизни куки — 1 день
        sameSite: 'strict', // Защита от CSRF-атак
      });
      return res.redirect('/admin');
    }

    // Если пароль неверный, рендерим страницу входа заново с текстом ошибки
    return res.render('login', { error: 'Неверный пароль!' });
  }

  // 6. Выход из админ-панели (Очистка куки)
  @Get('logout')
  logout(@Res() res: Response) {
    res.clearCookie('admin_session');
    return res.redirect('/admin/login');
  }
}
