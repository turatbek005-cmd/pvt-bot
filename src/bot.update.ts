import { Update, Start, On, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { AiService } from './ai.service';
import { PrismaService } from './prisma.service';

@Update()
export class BotUpdate {
  constructor(
    private readonly aiService: AiService,
    private readonly prismaService: PrismaService, // Внедряем нашу базу данных Prisma
  ) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const firstName = ctx.from?.first_name || '';
    const lastName = ctx.from?.last_name || '';
    const username = ctx.from?.username || '';

    // Регистрируем пользователя в БД (если его нет) или обновляем его данные
    await this.prismaService.user.upsert({
      where: { id: userId },
      update: { firstName, lastName, username },
      create: { id: userId, firstName, lastName, username },
    });

    await ctx.reply(
      `Здравствуйте, ${firstName}! 👋\n\n` +
        `Я официальный ИИ-ассистент Дирекции Парка Высоких Технологий КР.\n\n` +
        `Я могу ответить на ваши вопросы по законодательству ПВТ, налогам, уставу и порядку регистрации.\n\n` +
        `Чем я могу вам помочь?`,
    );
  }

  @On('text')
  async onMessage(@Ctx() ctx: Context) {
    if (!ctx.message || !('text' in ctx.message)) {
      return;
    }

    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const userText = ctx.message.text;

    try {
      await ctx.sendChatAction('typing');

      const firstName = ctx.from?.first_name || '';
      const lastName = ctx.from?.last_name || '';
      const username = ctx.from?.username || '';

      // 1. Убедимся, что пользователь есть в БД (на случай, если он не нажимал /start)
      await this.prismaService.user.upsert({
        where: { id: userId },
        update: { firstName, lastName, username },
        create: { id: userId, firstName, lastName, username },
      });

      // 2. Сохраняем сообщение пользователя в базу данных
      await this.prismaService.chatMessage.create({
        data: {
          userId,
          role: 'user',
          text: userText,
        },
      });

      // 3. Загружаем из базы историю последних 10 сообщений
      const dbMessages = await this.prismaService.chatMessage.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      // Переворачиваем массив обратно в хронологический порядок (от старых к новым)
      // и исключаем самое последнее сообщение, так как оно пойдет как текущий prompt в sendMessage
      const rawHistory = dbMessages
        .reverse()
        .slice(0, -1)
        .map((msg) => ({
          role:
            msg.role === 'assistant' ? ('model' as const) : ('user' as const),
          text: msg.text,
        }));

      // Умная фильтрация: находим индекс самого первого сообщения от пользователя ('user'),
      // так как Google Gemini строго требует, чтобы история начиналась именно с сообщения пользователя!
      const firstUserIndex = rawHistory.findIndex((msg) => msg.role === 'user');

      // Если нашли сообщение юзера — отрезаем всё, что было до него. Если нет — отправляем пустой массив истории.
      const historyForAi =
        firstUserIndex !== -1 ? rawHistory.slice(firstUserIndex) : [];

      // 4. Отправляем запрос в Gemini с учетом отфильтрованной истории
      const aiResponse = await this.aiService.generateAnswerWithHistory(
        userText,
        historyForAi,
      );



      // 5. Сохраняем ответ ИИ в базу данных
      await this.prismaService.chatMessage.create({
        data: {
          userId,
          role: 'assistant',
          text: aiResponse,
        },
      });

      // 6. Разрезаем ответ на безопасные по длине кусочки (для Telegram лимит 4096 символов)
      const messageChunks = this.splitMessage(aiResponse);

      // 7. Отправляем ответы пользователю
      for (const chunk of messageChunks) {
        await ctx.reply(chunk);
      }
    } catch (error) {
      console.error('Ошибка при обработке сообщения ботом:', error);
      await ctx.reply('Произошла ошибка при обработке вашего запроса.');
    }
  }

  private splitMessage(text: string, maxLength = 4000): string[] {
    const chunks: string[] = [];
    let currentChunk = '';

    const lines = text.split('\n');

    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > maxLength) {
        chunks.push(currentChunk);
        currentChunk = line;
      } else {
        currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }
}
