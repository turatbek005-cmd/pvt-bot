import { Update, Start, On, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { PrismaService } from './prisma.service';
import { DocumentService, SearchResultChunk } from './document.service'; // Импортируем интерфейс

@Update()
export class BotUpdate {
  constructor(
    private readonly aiService: AiService,
    private readonly prismaService: PrismaService,
    private readonly documentService: DocumentService,
    private readonly configService: ConfigService,
  ) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const firstName = ctx.from?.first_name || '';
    const lastName = ctx.from?.last_name || '';
    const username = ctx.from?.username || '';

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

      await this.prismaService.user.upsert({
        where: { id: userId },
        update: { firstName, lastName, username },
        create: { id: userId, firstName, lastName, username },
      });

      await this.prismaService.chatMessage.create({
        data: {
          userId,
          role: 'user',
          text: userText,
        },
      });

      const dbMessages = await this.prismaService.chatMessage.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });

      const rawHistory = dbMessages
        .reverse()
        .slice(0, -1)
        .map((msg) => ({
          role:
            msg.role === 'assistant' ? ('model' as const) : ('user' as const),
          text: msg.text,
        }));

      const firstUserIndex = rawHistory.findIndex((msg) => msg.role === 'user');
      const historyForAi =
        firstUserIndex !== -1 ? rawHistory.slice(firstUserIndex) : [];

      const optimizedQuery = await this.aiService.rewriteQuery(
        userText,
        historyForAi,
      );
      console.log(
        `[Query Rewriting] Оригинал: "${userText}" -> Оптимизированный запрос: "${optimizedQuery}"`,
      );

      const queryEmbedding = await this.aiService.getEmbedding(optimizedQuery);

      const similarChunks = await this.documentService.findSimilarChunks(
        queryEmbedding,
        5,
      );

      let contextText = '';
      if (similarChunks.length > 0) {
        contextText = similarChunks
          .map(
            (chunk: SearchResultChunk, index) =>
              `[Статья №${index + 1}]\n` +
              `Источник: ${chunk.source}\n` +
              `Текст статьи:\n${chunk.content}`,
          )
          .join('\n\n---\n\n');
      }

      const htpContactInfo =
        this.configService.get<string>('HTP_CONTACT_INFO') || 'Дирекцию ПВТ КР';

      const systemPrompt =
        `Ты — официальный ИИ-ассистент Дирекции Парка Высоких Технологий Кыргызской Республики (ПВТ КР).\n` +
        `Твоя цель — профессионально, вежливо и точно отвечать на вопросы резидентов и кандидатов на основе предоставленного законодательства.\n\n` +
        `СТРОГИЕ ОГРАНИЧЕНИЯ И ПРАВИЛА ПОВЕДЕНИЯ:\n` +
        `1. ОТВЕЧАЙ ИСКЛЮЧИТЕЛЬНО на основе предоставленного ниже КОНТЕКСТА.\n` +
        `2. Если в предоставленном КОНТЕКСТЕ нет ответа на вопрос пользователя, ты НЕ ИМЕЕШЬ ПРАВА использовать свои общие знания о мире, придумывать законы от себя или строить догадки. В этом случае строго ответь следующей фразой:\n` +
        `"К сожалению, в моей базе знаний нет информации по вашему вопросу. Пожалуйста, обратитесь к сотруднику Дирекции ПВТ КР за детальной консультацией.\nКонтакты Дирекции ПВТ КР: ${htpContactInfo}."\n` +
        `3. Будь лаконичен, выражайся официально-деловым юридическим языком. Структурируй ответы списками или абзацами для удобства чтения в мессенджере Telegram.\n` +
        `4. Если пользователь просто здоровается, представляется или ведет вежливую беседу (small talk), отвечай вежливо и дружелюбно, напоминая, что ты ИИ-ассистент ПВТ КР и готов помочь с вопросами по регистрации, налогам или уставу.\n\n` +
        `КОНТЕКСТ ИЗ ЗАКОНОВ ПВТ КР:\n` +
        `${contextText || 'Информация в базе знаний отсутствует.'}\n\n` +
        `ТЕКУЩИЙ ВОПРОС ПОЛЬЗОВАТЕЛЯ: ${userText}`;

      const aiResponse = await this.aiService.generateAnswerWithHistory(
        systemPrompt,
        historyForAi,
      );

      await this.prismaService.chatMessage.create({
        data: {
          userId,
          role: 'assistant',
          text: aiResponse,
        },
      });

      const messageChunks = this.splitMessage(aiResponse);
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
