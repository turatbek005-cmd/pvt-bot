import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AiService } from './ai.service';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

// Объявляем строгую структуру результатов поиска
export interface SearchResultChunk {
  id: string;
  content: string;
  source: string;
  distance: number;
}

@Injectable()
export class DocumentService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async onApplicationBootstrap() {
    try {
      const count = await this.prisma.documentChunk.count();
      if (count > 0) {
        console.log(
          '[DocumentService] База знаний уже заполнена. Пропускаем импорт.',
        );
        return;
      }

      console.log(
        '[DocumentService] Обнаружена пустая база знаний. Начинаем импорт...',
      );

      const filePath = path.resolve(process.cwd(), 'documents', 'pvt_law.txt');
      if (!fs.existsSync(filePath)) {
        console.error(
          `[DocumentService] Ошибка: файл не найден по пути: ${filePath}`,
        );
        return;
      }

      const rawText = fs.readFileSync(filePath, 'utf-8');
      const articles = rawText.split(/\r?\n\r?\n/).filter(Boolean);

      console.log(
        `[DocumentService] Найдено статей для импорта: ${articles.length}`,
      );

      for (const article of articles) {
        const source = article.split('\n')[0] || 'Закон о ПВТ КР';

        console.log(`[DocumentService] Генерируем вектор для: "${source}"...`);

        const embeddingArray = await this.ai.getEmbedding(article);
        const vectorString = `[${embeddingArray.join(',')}]`;
        const id = randomUUID();

        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "DocumentChunk" (id, content, source, embedding, "createdAt") VALUES ($1, $2, $3, $4::vector, NOW())`,
          id,
          article,
          source,
          vectorString,
        );
      }

      console.log(
        '[DocumentService] База знаний успешно импортирована и векторизована!',
      );
    } catch (error) {
      console.error(
        '[DocumentService] Ошибка во время импорта базы знаний:',
        error,
      );
    }
  }

  // Строго типизируем метод: теперь он возвращает Promise<SearchResultChunk[]> вместо any[]!
  async findSimilarChunks(
    queryVector: number[],
    limit = 2,
  ): Promise<SearchResultChunk[]> {
    const vectorString = `[${queryVector.join(',')}]`;

    const chunks = await this.prisma.$queryRawUnsafe<SearchResultChunk[]>(
      `SELECT id, content, source, (embedding <=> $1::vector) as distance 
       FROM "DocumentChunk" 
       ORDER BY distance ASC 
       LIMIT $2`,
      vectorString,
      limit,
    );

    return chunks;
  }
}
