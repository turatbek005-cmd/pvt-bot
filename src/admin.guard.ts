import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { createHash } from 'node:crypto';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const adminPassword =
      this.configService.get<string>('ADMIN_PASSWORD') || '12345';
    // Вычисляем ожидаемый токен как хэш SHA-256 от пароля администратора
    const expectedToken = createHash('sha256')
      .update(adminPassword)
      .digest('hex');

    const currentCookie = request.cookies?.['admin_session'];
    const isAuthorized = currentCookie === expectedToken;

    if (!isAuthorized) {
      response.redirect('/admin/login');
      return false;
    }

    return true;
  }
}
