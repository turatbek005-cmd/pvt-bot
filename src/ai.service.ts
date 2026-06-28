import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, EmbedContentRequest } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { PROMPTS } from './prompts.config';

interface ExtendedEmbedContentRequest extends EmbedContentRequest {
  outputDimensionality?: number;
}

@Injectable()
export class AiService implements OnModuleInit {
  private genAI!: GoogleGenerativeAI;
  private groq!: Groq;
  private groqModelName!: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    // Инициализируем Gemini только для генерации векторов
    const geminiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    if (geminiKey) {
      this.genAI = new GoogleGenerativeAI(geminiKey);
    }

    // Инициализируем Groq для всей работы с текстом
    const groqKey = this.configService.get<string>('GROQ_API_KEY') || '';
    this.groqModelName =
      this.configService.get<string>('GROQ_MODEL') || 'llama-3.1-8b-instant';
    if (groqKey) {
      this.groq = new Groq({ apiKey: groqKey });
    }
  }

  /**
   * Генерация ответа на основе контекста и истории сообщений через Groq.
   * Если ответ не может быть сгенерирован по контексту, модель вернет строго "590".
   */
  async generateAnswerWithHistory(
    prompt: string,
    history: Array<{ role: 'user' | 'model'; text: string }>,
    systemInstruction: string,
  ): Promise<string> {
    try {
      const messages = [
        { role: 'system' as const, content: systemInstruction },
        ...history.map((item) => ({
          role:
            item.role === 'model' ? ('assistant' as const) : ('user' as const),
          content: item.text,
        })),
        { role: 'user' as const, content: prompt },
      ];

      const chatCompletion = await this.groq.chat.completions.create({
        messages,
        model: this.groqModelName,
        temperature: 0.2, // Минимальная температура для точности и исключения отсебятины
      });

      return chatCompletion.choices[0]?.message?.content?.trim() || '590';
    } catch (error: unknown) {
      console.error('Ошибка в работе Groq API при генерации ответа:', error);
      let errorMsg = '';
      if (error instanceof Error) {
        errorMsg = error.message;
      }
      if (errorMsg.includes('429') || errorMsg.includes('Rate limit')) {
        return '⏱️ Превышен лимит запросов к Groq. Пожалуйста, подождите 1 минуту перед следующим запросом.';
      }
      return '🔧 Извините, произошла временная ошибка при обращении к ИИ. Попробуйте повторить запрос через минуту.';
    }
  }

  /**
   * Генерация эмбеддингов (векторов 768) через Gemini-embedding-001.
   */
  async getEmbedding(text: string): Promise<number[]> {
    try {
      if (!this.genAI) {
        throw new Error(
          'Google Generative AI не инициализирован. Проверьте GEMINI_API_KEY.',
        );
      }
      const embedModel = this.genAI.getGenerativeModel({
        model: 'gemini-embedding-001',
      });

      const result = await embedModel.embedContent({
        content: { role: 'user', parts: [{ text }] },
        outputDimensionality: 768,
      } as ExtendedEmbedContentRequest);

      return result.embedding.values;
    } catch (error: unknown) {
      console.error('Ошибка при генерации эмбеддинга через Gemini:', error);
      throw error;
    }
  }

  /**
   * Оптимизация поискового запроса (Query Rewriting) с использованием истории через Groq.
   */
  async rewriteQuery(
    prompt: string,
    history: Array<{ role: 'user' | 'model'; text: string }>,
  ): Promise<string> {
    try {
      const historyText = history
        .map((h) => `${h.role === 'model' ? 'Бот' : 'Пользователь'}: ${h.text}`)
        .join('\n');

      const rewritePrompt = PROMPTS.QUERY_REWRITE(historyText, prompt);

      const chatCompletion = await this.groq.chat.completions.create({
        messages: [{ role: 'user' as const, content: rewritePrompt }],
        model: this.groqModelName,
        temperature: 0.1,
      });

      return chatCompletion.choices[0]?.message?.content?.trim() || prompt;
    } catch (error) {
      console.error('Ошибка при переписывании запроса через Groq:', error);
      return prompt;
    }
  }
}
