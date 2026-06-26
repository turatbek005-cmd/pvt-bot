import { Controller, Get, Render } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('admin') // Наша админка будет доступна по адресу http://localhost:3000/admin
export class AdminController {
  constructor(private readonly adminService: AdminService) {}


  @Get()
  @Render('index') // Будет рендерить файл views/index.ejs
  async getDashboard() {
    const stats = await this.adminService.getDashboardStats();
    return {
      stats,
      activeTab: 'dashboard',
    };
  }


  @Get('logs')
  @Render('logs') // Будет рендерить файл views/logs.ejs
  async getLogs() {
    const logs = await this.adminService.getChatLogs();
    return {
      logs,
      activeTab: 'logs',
    };
  }


  @Get('documents')
  @Render('documents') // Будет рендерить файл views/documents.ejs
  async getDocuments() {
    const docs = await this.adminService.getUploadedDocuments();
    return {
      docs,
      activeTab: 'documents',
    };
  }
}
