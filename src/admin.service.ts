import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // 1. Получаем общие цифры статистики для Дашборда
  async getDashboardStats() {
    const totalUsers = await this.prisma.user.count();
    const totalMessages = await this.prisma.chatMessage.count();

    // Считаем только те сообщения, на которые бот ответил нашей точной заглушкой
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

  // 2. Получаем историю всех переписок с поддержкой фильтров (?filter=user / bot / unhandled)
  async getChatLogs(filter?: string, limit = 100) {
    const whereClause: any = {};

    if (filter === 'user') {
      whereClause.role = 'user';
    } else if (filter === 'bot') {
      whereClause.role = 'assistant';
    } else if (filter === 'unhandled') {
      whereClause.role = 'assistant';
      whereClause.text = {
        contains: 'К сожалению, в моей базе знаний нет информации',
      };
    }

    return this.prisma.chatMessage.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: true, // Подтягиваем данные о пользователе
      },
    });
  }

  // 3. Получаем список всех пользователей и считаем количество их сообщений (через Prisma _count)
  async getUsersList() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { messages: true }, // Prisma сама посчитает количество сообщений пользователя
        },
      },
    });
  }

  // 4. Находим пользователя по его ID
  async getUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  // 5. Получаем диалог конкретного пользователя по его ID
  async getUserChatLogs(userId: string) {
    return this.prisma.chatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' }, // Диалог конкретного юзера сортируем снизу вверх для удобства чтения
    });
  }

  // 6. Получаем список всех загруженных документов
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

  // 7. Получаем документ по его ID (для редактирования)
  async getDocumentById(id: string) {
    return this.prisma.documentChunk.findUnique({
      where: { id },
    });
  }

  // 8. Удаляем документ по его ID
  async deleteDocument(id: string) {
    return this.prisma.documentChunk.delete({
      where: { id },
    });
  }
}
