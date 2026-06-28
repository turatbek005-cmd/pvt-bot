import { Update, Start, Help, On, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { PrismaService } from './prisma.service';
import { DocumentService, SearchResultChunk } from './document.service';
import { PROMPTS } from './prompts.config';

@Update()
export class BotUpdate {
  private userCooldowns = new Map<string, number[]>();

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

  @Help()
  async onHelp(@Ctx() ctx: Context) {
    await ctx.reply(
      `❓ Справка по использованию ИИ-ассистента ПВТ КР:\n\n` +
        `Я — умный помощник, подключенный к официальной юридической базе знаний Парка Высоких Технологий КР. Моя цель — отвечать на ваши вопросы строго по закону.\n\n` +
        `📌 Что я умею делать:\n` +
        `• Отвечать на вопросы по налогам и льготам для резидентов ПВТ.\n` +
        `• Объяснять порядок регистрации и требования к кандидатам.\n` +
        `• Понимать вопросы на кыргызском, русском и английском языках (кыргызча, орусча, англисче).\n\n` +
        `⚙️ Команды бота:\n` +
        `/start — Запустить бота и получить приветствие.\n` +
        `/help — Показать это справочное меню.\n\n` +
        `💬 Просто напишите свой вопрос в чат (например: "Каковы налоговые ставки для резидента ПВТ КР?"), и я мгновенно найду нужную статью закона!`,
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

    // Предохранитель от спама (Throttling)
    const now = Date.now();
    const userRequests = this.userCooldowns.get(userId) || [];
    const recentRequests = userRequests.filter(
      (timestamp) => now - timestamp < 10000,
    );

    if (recentRequests.length >= 3) {
      console.warn(
        `[Anti-Spam] Заблокирован спам-запрос от пользователя ID: ${userId}`,
      );
      await ctx.reply(
        '⚠️ Пожалуйста, не отправляйте запросы так часто!\n\n' +
          'Я работаю на бесплатном тарифе разработки. Отправляйте вопросы не чаще одного раза в 3 секунды. Спасибо за понимание! 🙏',
      );
      return;
    }

    recentRequests.push(now);
    this.userCooldowns.set(userId, recentRequests);

    try {
      await ctx.sendChatAction('typing');

      const firstName = ctx.from?.first_name || '';
      const lastName = ctx.from?.last_name || '';
      const username = ctx.from?.username || '';

      // Создаем или обновляем пользователя в БД
      await this.prismaService.user.upsert({
        where: { id: userId },
        update: { firstName, lastName, username },
        create: { id: userId, firstName, lastName, username },
      });

      // Сохраняем вопрос пользователя
      await this.prismaService.chatMessage.create({
        data: {
          userId,
          role: 'user',
          text: userText,
        },
      });

      // Извлекаем историю переписки
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

      const greetings = [
        'привет',
        'здравствуйте',
        'салам',
        'саламатсызбы',
        'hello',
        'hi',
        'добрый день',
        'доброе утро',
        'добрый вечер',
      ];
      const isSimpleGreeting = greetings.some(
        (g) =>
          userText.toLowerCase().trim().startsWith(g) ||
          userText.toLowerCase().trim() === g,
      );

      const htpContactInfo =
        this.configService.get<string>('HTP_CONTACT_INFO') || 'Дирекцию ПВТ КР';

      // Шаблон сообщения при отсутствии ответа в базе знаний
      const fallbackNoAnswerMessage =
        `К сожалению, в моей базе знаний нет информации по вашему вопросу. 📇\n\n` +
        `Пожалуйста, обратитесь к сотруднику Дирекции ПВТ КР за детальной консультацией:\n` +
        `📞 ${htpContactInfo}`;

      let contextText = '';
      let detectedLanguage = 'русский'; // По умолчанию

      if (!isSimpleGreeting) {
        // Оптимизируем запрос через Groq
        const rawOutput = await this.aiService.rewriteQuery(
          userText,
          historyForAi,
        );
        console.log(`[Query Rewriting] Результат от Groq: "${rawOutput}"`);

        // Разделяем запрос и язык с помощью регулярного выражения
        const languageMatch = rawOutput.match(/(.*)\s*\(Язык:\s*(.*?)\)/i);
        let cleanQuery = rawOutput;

        if (languageMatch) {
          cleanQuery = languageMatch[1].trim();
          detectedLanguage = languageMatch[2].trim();
        }

        console.log(
          `[Language Detector] Чистый запрос: "${cleanQuery}" | Язык оригинала: "${detectedLanguage}"`,
        );

        // Генерируем вектор только для чистого запроса
        const queryEmbedding = await this.aiService.getEmbedding(cleanQuery);

        // Ищем похожие статьи в PostgreSQL
        const similarChunks = await this.documentService.findSimilarChunks(
          queryEmbedding,
          5,
        );

        // ЗАЩИТА УРОВНЯ 1: Сходство вектора по порогу 0.5
        const bestMatch = similarChunks[0];
        const hasGoodMatch = bestMatch && Number(bestMatch.distance) <= 0.5;

        if (!hasGoodMatch) {
          console.log(
            `[RAG Search] Статей не найдено (лучшее расстояние: ${bestMatch ? bestMatch.distance : 'нет'}). Отказ.`,
          );

          await this.prismaService.chatMessage.create({
            data: {
              userId,
              role: 'assistant',
              text: fallbackNoAnswerMessage,
            },
          });

          await ctx.reply(fallbackNoAnswerMessage);
          return;
        }

        // Собираем контекст из найденных статей
        contextText = similarChunks
          .filter((chunk: SearchResultChunk) => Number(chunk.distance) <= 0.5)
          .map(
            (chunk: SearchResultChunk, index) =>
              `[Статья №${index + 1}]\n` +
              `Источник: ${chunk.source}\n` +
              `Текст статьи:\n${chunk.content}`,
          )
          .join('\n\n---\n\n');
      }

      // Передаем определенный язык прямо в системную инструкцию
      const systemInstruction = PROMPTS.SYSTEM_INSTRUCTION(detectedLanguage);

      const userPrompt = isSimpleGreeting
        ? userText
        : PROMPTS.USER_PROMPT_WITH_CONTEXT(contextText, userText);
      // Отправляем запрос в Groq
      const aiResponse = await this.aiService.generateAnswerWithHistory(
        userPrompt,
        historyForAi,
        systemInstruction,
      );

      // ЗАЩИТА УРОВНЯ 2: Если Groq не нашел ответа и вернул код 590
      const finalBotText =
        aiResponse.trim() === '590' ? fallbackNoAnswerMessage : aiResponse;

      // Записываем ответ бота в историю
      await this.prismaService.chatMessage.create({
        data: {
          userId,
          role: 'assistant',
          text: finalBotText,
        },
      });

      // Разбиваем длинные сообщения и отправляем пользователю
      const messageChunks = this.splitMessage(finalBotText);
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
