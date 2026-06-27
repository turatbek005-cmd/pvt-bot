import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Объявляем структуру результатов поиска
export interface SearchResultChunk {
  id: string;
  content: string;
  source: string;
  distance: number;
}

@Injectable()
export class DocumentService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService, // Оставили только действительно используемую Prisma
  ) {}

  // Метод запускается автоматически при старте приложения
  onApplicationBootstrap() {
    // Мы отключили автоматический импорт, так как база знаний уже заполнена и управляется через Админ-панель
    console.log(
      '[DocumentService] Автоматический импорт отключен. База знаний управляется через Админ-панель.',
    );
  }

  // МЕТОД: Семантический поиск похожих статей закона по вектору вопроса
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
