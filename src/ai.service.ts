import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenerativeAI,
  GenerativeModel,
  EmbedContentRequest,
} from '@google/generative-ai';
import Groq from 'groq-sdk';

interface ExtendedEmbedContentRequest extends EmbedContentRequest {
  outputDimensionality?: number;
}

@Injectable()
export class AiService implements OnModuleInit {
  // Настройки для Google Gemini
  private genAI!: GoogleGenerativeAI;
  private geminiModel!: GenerativeModel;

  // Настройки для Groq
  private groq!: Groq;
  private groqModelName!: string;

  // Имя активного провайдера ("gemini" или "groq")
  private activeProvider!: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    // Считываем из .env, какой ИИ сейчас активен
    this.activeProvider =
      this.configService.get<string>('ACTIVE_AI_PROVIDER') || 'gemini';

    // 1. Инициализируем настройки Google Gemini
    const geminiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    if (geminiKey) {
      this.genAI = new GoogleGenerativeAI(geminiKey);
      this.geminiModel = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });
    }

    // 2. Инициализируем настройки Groq
    const groqKey = this.configService.get<string>('GROQ_API_KEY') || '';
    this.groqModelName =
      this.configService.get<string>('GROQ_MODEL') || 'llama-3.1-8b-instant';
    if (groqKey) {
      this.groq = new Groq({ apiKey: groqKey });
    }
  }
  // МЕТОД: ИИ-препроцессинг (Query Rewriting) — превращает нечеткий вопрос в четкий поисковый запрос
  async rewriteQuery(
    prompt: string,
    history: Array<{ role: 'user' | 'model'; text: string }>,
  ): Promise<string> {
    try {
      // Если истории нет, переписывать нечего — возвращаем исходный текст
      if (history.length === 0) {
        return prompt;
      }

      console.log(
        '[AiService] Запускаем Query Rewriting для оптимизации поиска...',
      );

      const historyText = history
        .map((h) => `${h.role === 'model' ? 'Бот' : 'Пользователь'}: ${h.text}`)
        .join('\n');

      const rewritePrompt =
        `Ты — эксперт по анализу текстов. Твоя задача — прочитать историю диалога и последний вопрос пользователя, а затем сформулировать ОДИН единственный точный и конкретный поисковый запрос на русском языке для поиска в базе данных законов ПВТ КР.\n` +
        `ПРАВИЛО: Верни только очищенный текст поискового запроса и больше ничего. Никаких кавычек, пояснений или вступлений!\n\n` +
        `История диалога:\n${historyText}\n\n` +
        `Последний нечеткий вопрос пользователя: ${prompt}\n\n` +
        `Оптимизированный поисковый запрос для базы данных:`;

      // Используем активный в данный момент ИИ (Gemini или Groq)
      if (this.activeProvider === 'groq') {
        const chatCompletion = await this.groq.chat.completions.create({
          messages: [{ role: 'user', content: rewritePrompt }],
          model: this.groqModelName,
        });
        return chatCompletion.choices[0]?.message?.content?.trim() || prompt;
      } else {
        // Для Gemini используем простой быстрый вызов без сохранения этой технической задачи в историю
        const chat = this.geminiModel.startChat();
        const result = await chat.sendMessage(rewritePrompt);
        return result.response.text().trim() || prompt;
      }
    } catch (error) {
      console.error(
        'Ошибка при переписывании запроса (Query Rewriting):',
        error,
      );
      return prompt; // В случае сбоя просто возвращаем оригинальный текст, чтобы бот не падал
    }
  }
  // Единая точка входа для бота (сама решает, кому отправить запрос)
  async generateAnswerWithHistory(
    prompt: string,
    history: Array<{ role: 'user' | 'model'; text: string }>,
  ): Promise<string> {
    if (this.activeProvider === 'groq') {
      return this.generateWithGroq(prompt, history);
    }

    // По умолчанию используем Gemini
    return this.generateWithGemini(prompt, history);
  }

  // ЛОГИКА РАБОТЫ С GOOGLE GEMINI
  private async generateWithGemini(
    prompt: string,
    history: Array<{ role: 'user' | 'model'; text: string }>,
  ): Promise<string> {
    try {
      const formattedHistory = history.map((item) => ({
        role: item.role,
        parts: [{ text: item.text }],
      }));

      const chat = this.geminiModel.startChat({
        history: formattedHistory,
      });

      const result = await chat.sendMessage(prompt);
      return result.response.text();
    } catch (error: unknown) {
      console.error('Ошибка в работе Gemini API:', error);

      let errorMsg = '';
      if (error instanceof Error) {
        errorMsg = error.message;
      }

      if (
        errorMsg.includes('503') ||
        errorMsg.includes('Service Unavailable') ||
        errorMsg.includes('high demand')
      ) {
        return '🚦 Сервера Google Gemini сейчас временно перегружены. Пожалуйста, подождите 30 секунд и отправьте ваш вопрос заново.';
      }

      if (
        errorMsg.includes('429') ||
        errorMsg.includes('Too Many Requests') ||
        errorMsg.includes('quota')
      ) {
        return '⏱️ Превышен дневной лимит бесплатных запросов к Google Gemini.';
      }

      return '🔧 Извините, произошла временная ошибка при обращении к Gemini. Пожалуйста, попробуйте повторить запрос через минуту.';
    }
  }

  // ЛОГИКА РАБОТЫ С GROQ (LLAMA 3)
  private async generateWithGroq(
    prompt: string,
    history: Array<{ role: 'user' | 'model'; text: string }>,
  ): Promise<string> {
    try {
      // Форматируем историю под стандарты OpenAI/Groq (где роль пишется как 'assistant')
      const messages = history.map((item) => ({
        role:
          item.role === 'model' ? ('assistant' as const) : ('user' as const),
        content: item.text,
      }));

      // Добавляем текущий промпт
      messages.push({ role: 'user', content: prompt });

      const chatCompletion = await this.groq.chat.completions.create({
        messages: messages,
        model: this.groqModelName,
      });

      return (
        chatCompletion.choices[0]?.message?.content || 'Ответ от Groq пуст.'
      );
    } catch (error: unknown) {
      console.error('Ошибка в работе Groq API:', error);

      let errorMsg = '';
      if (error instanceof Error) {
        errorMsg = error.message;
      } else if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error
      ) {
        errorMsg = String((error as Record<string, unknown>).message);
      }

      // Умная обработка ошибок для Groq
      if (
        errorMsg.includes('401') ||
        errorMsg.includes('Invalid API Key') ||
        errorMsg.includes('invalid_api_key')
      ) {
        return '🔑 Ошибка авторизации Groq: Неверный или неактивный API-ключ в файле .env. Пожалуйста, перевыпустите ключ на console.groq.com и проверьте его.';
      }

      if (errorMsg.includes('429') || errorMsg.includes('Rate limit')) {
        return '⏱️ Превышен лимит запросов к Groq. Пожалуйста, подождите 1 минуту перед следующим запросом.';
      }

      return '🔧 Извините, произошла временная ошибка при обращении к резервному ИИ Groq. Попробуйте повторить запрос через минуту.';
    }
  }

  // Метод получения эмбеддинга (всегда работает через Google, так как у Groq нет бесплатной модели векторизации)
  async getEmbedding(text: string): Promise<number[]> {
    try {
      const embedModel = this.genAI.getGenerativeModel({
        model: 'gemini-embedding-001',
      });

      const result = await embedModel.embedContent({
        content: { role: 'user', parts: [{ text }] },
        outputDimensionality: 768,
      } as ExtendedEmbedContentRequest);

      return result.embedding.values;
    } catch (error: unknown) {
      console.error('Ошибка при генерации эмбеддинга:', error);
      throw error;
    }
  }
}
