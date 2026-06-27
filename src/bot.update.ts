import { Update, Start, Help, On, Ctx } from 'nestjs-telegraf'; // Импортировали Help
import { Context } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { AiService } from './ai.service';
import { PrismaService } from './prisma.service';
import { DocumentService, SearchResultChunk } from './document.service';

@Update()
export class BotUpdate {
  // Карта для отслеживания анти-спама (хранит ID пользователя и массив меток времени его сообщений)
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

  // ШАГ 4.2: Команда /help (Справка для пользователей)
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

    // ==============================================
    // ШАГ 4.1: АНТИ-СПАМ ПРЕДОХРАНИТЕЛЬ (Throttling)
    // ==============================================
    const now = Date.now();
    const userRequests = this.userCooldowns.get(userId) || [];

    // Оставляем только те метки времени, которые были за последние 10 секунд
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

    // Записываем текущую метку времени сообщения
    recentRequests.push(now);
    this.userCooldowns.set(userId, recentRequests);
    // ==============================================

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
        take: 30, // Память на 30 сообщений
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

      let contextText = '';
      let hasGoodMatch = true;

      if (!isSimpleGreeting) {
        const optimizedQuery = await this.aiService.rewriteQuery(
          userText,
          historyForAi,
        );
        console.log(
          `[Query Rewriting] Оригинал: "${userText}" -> Оптимизированный запрос: "${optimizedQuery}"`,
        );

        const queryEmbedding =
          await this.aiService.getEmbedding(optimizedQuery);

        const similarChunks = await this.documentService.findSimilarChunks(
          queryEmbedding,
          5,
        );

        const htpContactInfo =
          this.configService.get<string>('HTP_CONTACT_INFO') ||
          'Дирекцию ПВТ КР';

        const bestMatch = similarChunks[0];
        hasGoodMatch = bestMatch && Number(bestMatch.distance) <= 0.4;

        if (!hasGoodMatch) {
          console.log(
            `[RAG Search] Совпадений не найдено (лучшее расстояние: ${bestMatch ? bestMatch.distance : 'нет'}). Возвращаем контакты.`,
          );

          const noAnswerMsg =
            `К сожалению, в моей базе знаний нет информации по вашему вопросу. 📇\n\n` +
            `Пожалуйста, обратитесь к сотруднику Дирекции ПВТ КР за детальной консультацией:\n` +
            `📞 ${htpContactInfo}`;

          await this.prismaService.chatMessage.create({
            data: {
              userId,
              role: 'assistant',
              text: noAnswerMsg,
            },
          });

          await ctx.reply(noAnswerMsg);
          return;
        }

        contextText = similarChunks
          .filter((chunk: SearchResultChunk) => Number(chunk.distance) <= 0.4)
          .map(
            (chunk: SearchResultChunk, index) =>
              `[Статья №${index + 1}]\n` +
              `Источник: ${chunk.source}\n` +
              `Текст статьи:\n${chunk.content}`,
          )
          .join('\n\n---\n\n');
      } else {
        console.log(
          `[Greeting Detector] Обнаружено простое приветствие. Пропускаем поиск в БД.`,
        );
      }

      const htpContactInfo =
        this.configService.get<string>('HTP_CONTACT_INFO') || 'Дирекцию ПВТ КР';

      const systemInstruction =
        `Ты — официальный ИИ-ассистент Дирекции Парка Высоких Технологий Кыргызской Республики (ПВТ КР).\n` +
        `Твоя цель — профессионально, вежливо и точно отвечать на вопросы резидентов и кандидатов на основе предоставленного законодательства.\n\n` +
        `СТРОГИЕ ОГРАНИЧЕНИЯ И ПРАВИЛА ПОВЕДЕНИЯ:\n` +
        `1. ОТВЕЧАЙ ИСКЛЮЧИТЕЛЬНО на основе предоставленного КОНТЕКСТА.\n` +
        `2. Если в предоставленном КОНТЕКСТЕ нет ответа на вопрос пользователя, ты НЕ ИМЕЕШЬ ПРАВА использовать свои общие знания о мире, придумывать законы от себя или строить догадки. В этом случае строго ответь следующей фразой:\n` +
        `"К сожалению, в моей базе знаний нет информации по вашему вопросу. Пожалуйста, обратитесь к сотруднику Дирекции ПВТ КР за детальной консультацией.\nКонтакты Дирекции ПВТ КР: ${htpContactInfo}."\n` +
        `3. ПРАВИЛО ДИАЛОГА (БЕЗ ПОВТОРНЫХ ПРИВЕТСТВИЙ): Никогда не здоровайся заново ("Здравствуйте", "Добрый день") и не представляйся заново в каждом сообщении, если диалог уже идет! Отвечай сразу по делу, кратко и профессионально.\n` +
        `4. ПРАВИЛО ЯЗЫКА (МУЛЬТИЯЗЫЧНОСТЬ): Отвечай строго на том языке, на котором пользователь задал свой текущий вопрос (например, если вопрос на кыргызском — переведи предоставленный русский контекст законов и ответь на красивом кыргызском; если на английском — на английском, если на русском — на русском).\n` +
        `5. Будь лаконичен, выражайся официально-деловым юридическим языком. Структурируй ответы списками или абзацами для удобства чтения в мессенджере Telegram.`;

      const userPrompt = isSimpleGreeting
        ? userText
        : `КОНТЕКСТ ИЗ ЗАКОНОВ ПВТ КР:\n${contextText}\n\nТЕКУЩИЙ ВОПРОС ПОЛЬЗОВАТЕЛЯ: ${userText}`;

      const aiResponse = await this.aiService.generateAnswerWithHistory(
        userPrompt,
        historyForAi,
        systemInstruction,
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
