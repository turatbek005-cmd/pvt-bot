import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

@Injectable()
export class AiService implements OnModuleInit {
  private genAI!: GoogleGenerativeAI;
  private model!: GenerativeModel;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  }

  // Наш старый метод для простых одиночных вопросов
  async generateAnswer(prompt: string): Promise<string> {
    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      return response.text();
    } catch (error) {
      console.error('Ошибка в работе AiService:', error);
      return 'Извините, произошла ошибка при обращении к ИИ. Попробуйте позже.';
    }
  }

  // НОВЫЙ метод для ведения диалога с учетом истории
  async generateAnswerWithHistory(
    prompt: string,
    history: Array<{ role: 'user' | 'model'; text: string }>,
  ): Promise<string> {
    try {
      // Форматируем историю сообщений в структуру, которую строго требует SDK Gemini
      const formattedHistory = history.map((item) => ({
        role: item.role,
        parts: [{ text: item.text }],
      }));

      // Инициализируем сессию чата с переданной историей
      const chat = this.model.startChat({
        history: formattedHistory,
      });

      // Отправляем текущее сообщение пользователя в активную сессию чата
      const result = await chat.sendMessage(prompt);
      const response = result.response;
      return response.text();
    } catch (error) {
      console.error('Ошибка при генерации ответа с историей:', error);
      return 'Извините, произошла ошибка при генерации контекстного ответа.';
    }
  }
}
