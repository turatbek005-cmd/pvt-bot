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
  private genAI!: GoogleGenerativeAI;
  private geminiModel!: GenerativeModel;

  private groq!: Groq;
  private groqModelName!: string;

  private activeProvider!: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.activeProvider =
      this.configService.get<string>('ACTIVE_AI_PROVIDER') || 'gemini';

    const geminiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    if (geminiKey) {
      this.genAI = new GoogleGenerativeAI(geminiKey);
      this.geminiModel = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });
    }

    const groqKey = this.configService.get<string>('GROQ_API_KEY') || '';
    this.groqModelName =
      this.configService.get<string>('GROQ_MODEL') || 'llama-3.1-8b-instant';
    if (groqKey) {
      this.groq = new Groq({ apiKey: groqKey });
    }
  }

  // Единая точка входа с поддержкой жестких системных правил
  async generateAnswerWithHistory(
    prompt: string,
    history: Array<{ role: 'user' | 'model'; text: string }>,
    systemInstruction: string, // <--- Принимаем системные правила
  ): Promise<string> {
    if (this.activeProvider === 'groq') {
      return this.generateWithGroq(prompt, history, systemInstruction);
    }
    return this.generateWithGemini(prompt, history, systemInstruction);
  }

  // Метод работы с Gemini: динамически внедряет системные правила в модель Google!
  private async generateWithGemini(
    prompt: string,
    history: Array<{ role: 'user' | 'model'; text: string }>,
    systemInstruction: string,
  ): Promise<string> {
    try {
      const formattedHistory = history.map((item) => ({
        role: item.role,
        parts: [{ text: item.text }],
      }));

      // Инициализируем модель с жесткими системными рамками
      const modelWithInstruction = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        systemInstruction: systemInstruction, // Google строго подчинит ИИ этим правилам!
      });

      const chat = modelWithInstruction.startChat({
        history: formattedHistory,
      });

      // Отправляем только чистый вопрос и контекст
      const result = await chat.sendMessage(prompt);
      const response = result.response;
      return response.text();
    } catch (error: unknown) {
      console.error('Ошибка при генерации ответа через Gemini:', error);

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
        return '⏱️ Превышен дневной лимит бесплатных запросов к Google Gemini. Вы можете зайти в файл .env и переключить ACTIVE_AI_PROVIDER на "groq" для работы с резервной моделью Llama 3!';
      }

      return '🔧 Извините, произошла временная ошибка при обращении к Gemini. Пожалуйста, попробуйте повторить запрос через минуту.';
    }
  }

  private async generateWithGroq(
    prompt: string,
    history: Array<{ role: 'user' | 'model'; text: string }>,
    systemInstruction: string,
  ): Promise<string> {
    try {
      const messages = [
        // Внедряем системную роль в начало массива сообщений
        { role: 'system' as const, content: systemInstruction },
        ...history.map((item) => ({
          role:
            item.role === 'model' ? ('assistant' as const) : ('user' as const),
          content: item.text,
        })),
      ];

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
      }

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

      return '🔧 Извините, произошла временная ошибка при обращении к Groq. Попробуйте повторить запрос через минуту.';
    }
  }

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

  async rewriteQuery(
    prompt: string,
    history: Array<{ role: 'user' | 'model'; text: string }>,
  ): Promise<string> {
    try {
      const historyText = history
        .map((h) => `${h.role === 'model' ? 'Бот' : 'Пользователь'}: ${h.text}`)
        .join('\n');

      const rewritePrompt =
        `Ты — эксперт по анализу текстов и профессиональный переводчик.\n` +
        `Твоя задача — прочитать историю диалога и последний вопрос пользователя, перевести его на РУССКИЙ язык (если он задан на кыргызском, английском или любом другом языке) и сформулировать ОДИН единственный точный и конкретный поисковый запрос на русском языке для поиска в базе данных законов ПВТ КР.\n` +
        `ПРАВИЛО: Верни только чистый текст этого поискового запроса на русском языке и больше ничего. Никаких кавычек, пояснений или вступлений!\n\n` +
        `История диалога:\n${historyText || 'История пуста.'}\n\n` +
        `Последний вопрос пользователя: ${prompt}\n\n` +
        `Оптимизированный поисковый запрос на русском языке:`;

      if (this.activeProvider === 'groq') {
        const chatCompletion = await this.groq.chat.completions.create({
          messages: [{ role: 'user', content: rewritePrompt }],
          model: this.groqModelName,
        });
        return chatCompletion.choices[0]?.message?.content?.trim() || prompt;
      } else {
        const chat = this.geminiModel.startChat();
        const result = await chat.sendMessage(rewritePrompt);
        return result.response.text().trim() || prompt;
      }
    } catch (error) {
      console.error(
        'Ошибка при переписывании запроса (Query Rewriting):',
        error,
      );
      return prompt;
    }
  }
}
