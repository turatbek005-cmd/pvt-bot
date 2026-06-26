import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const isAuthorized = request.cookies?.['admin_session'] === 'authorized';
    if (!isAuthorized) {
      response.redirect('/admin/login');
      return false;
    }

    return true;
  }
}
