import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}


  async getDashboardStats() {
    const totalUsers = await this.prisma.user.count();
    const totalMessages = await this.prisma.chatMessage.count();

    // Считаем, сколько раз бот не смог ответить на вопросы резидентов
    const unhandledCount = await this.prisma.chatMessage.count({
      where: {
        role: 'assistant',
        text: {
          contains: 'К сожалению, в моей базе знаний нет информации',
        },
      },
    });

    return {
      totalUsers,
      totalMessages,
      unhandledCount,
    };
  }


  async getChatLogs(limit = 100) {
    return this.prisma.chatMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: true, // Подтягиваем данные о пользователе (имя, фамилию, никнейм)
      },
    });
  }


  async getUploadedDocuments() {
    return this.prisma.documentChunk.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        source: true,
        content: true,
        createdAt: true,
      },
    });
  }
}
