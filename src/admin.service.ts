import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ChatMessage, User, Prisma } from '@prisma/client'; // Импортируем Prisma для строгого типа условий

// Создаем строгий тип связи сообщения с пользователем
type ChatMessageWithUser = ChatMessage & { user: User };

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // 1. Получаем общие цифры статистики для Дашборда
  async getDashboardStats() {
    const totalUsers = await this.prisma.user.count();
    const totalMessages = await this.prisma.chatMessage.count();

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

  // 2. Получаем историю переписок с умной фильтрацией реальных вопросов без ответа
  async getChatLogs(
    filter?: string,
    limit = 100,
  ): Promise<ChatMessageWithUser[]> {
    // =========================================================
    // УМНАЯ ФИЛЬТРАЦИЯ: Выводим РЕАЛЬНЫЕ ВОПРОСЫ ПОЛЬЗОВАТЕЛЕЙ, на которые бот не ответил
    // =========================================================
    if (filter === 'unhandled') {
      const unhandledBotMessages = await this.prisma.chatMessage.findMany({
        where: {
          role: 'assistant',
          text: {
            contains: 'К сожалению, в моей базе знаний нет информации',
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      const unansweredUserMessages: ChatMessageWithUser[] = [];

      for (const botMsg of unhandledBotMessages) {
        const userMsg = await this.prisma.chatMessage.findFirst({
          where: {
            userId: botMsg.userId,
            role: 'user',
            createdAt: {
              lt: botMsg.createdAt,
            },
          },
          orderBy: { createdAt: 'desc' },
          include: {
            user: true,
          },
        });

        if (userMsg) {
          unansweredUserMessages.push(userMsg);
        }
      }
      return unansweredUserMessages;
    }

    // Вместо "any" используем строгий тип Prisma.ChatMessageWhereInput!
    const whereClause: Prisma.ChatMessageWhereInput = {};
    if (filter === 'user') {
      whereClause.role = 'user';
    } else if (filter === 'bot') {
      whereClause.role = 'assistant';
    }

    // Убрали лишнее "as Promise..." в конце, так как Prisma сама возвращает нужный тип!
    return this.prisma.chatMessage.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: true,
      },
    });
  }

  // 3. Получаем список всех пользователей и считаем количество их сообщений (через Prisma _count)
  async getUsersList() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { messages: true },
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
      orderBy: { createdAt: 'asc' },
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
