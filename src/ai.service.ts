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

    // Инициализируем модель
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
    });
  }

  async generateAnswer(prompt: string): Promise<string> {
    try {
      const result = await this.model.generateContent(prompt);
      const response = result.response; // УБРАЛИ лишний await здесь!
      return response.text(); // Вызываем метод получения текста
    } catch (error) {
      console.error('Ошибка в работе AiService:', error);
      return 'Извините, произошла ошибка при обращении к ИИ. Попробуйте позже.';
    }
  }
}
