import { Update, Start, On, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { AiService } from './ai.service';

@Update()
export class BotUpdate {
  constructor(private readonly aiService: AiService) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const userName = ctx.from?.first_name || 'уважаемый гость';

    await ctx.reply(
      `Здравствуйте, ${userName}! 👋\n\n` +
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

    const userText = ctx.message.text;

    try {
      await ctx.sendChatAction('typing');

      // Отправляем запрос в Gemini
      const aiResponse = await this.aiService.generateAnswer(userText);

      // Разрезаем ответ ИИ на безопасные кусочки
      const messageChunks = this.splitMessage(aiResponse);

      // Отправляем каждый кусочек отдельным сообщением
      for (const chunk of messageChunks) {
        await ctx.reply(chunk);
      }
    } catch (error) {
      console.error('Ошибка при обработке сообщения ботом:', error);
      await ctx.reply('Произошла ошибка при обработке вашего запроса.');
    }
  }

  /**
   * Профессиональный хелпер для нарезки длинных текстов по абзацам
   */
  private splitMessage(text: string, maxLength = 4000): string[] {
    const chunks: string[] = [];
    let currentChunk = '';

    // Разделяем текст по строкам, чтобы не разрывать слова и Markdown-разметку
    const lines = text.split('\n');

    for (const line of lines) {
      // Если добавление новой строки превысит лимит, сохраняем текущий чанк
      if (currentChunk.length + line.length + 1 > maxLength) {
        chunks.push(currentChunk);
        currentChunk = line; // Начинаем новый чанк со следующей строки
      } else {
        // Иначе продолжаем накапливать чанк
        currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
      }
    }

    // Добавляем последний кусочек, если он остался
    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }
}
