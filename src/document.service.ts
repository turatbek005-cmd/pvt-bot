import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export interface SearchResultChunk {
  id: string;
  content: string;
  source: string;
  distance: number;
}

@Injectable()
export class DocumentService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    console.log(
      '[DocumentService] Автоматический импорт отключен. База знаний управляется через Админ-панель.',
    );
  }

  /**
   * Семантический поиск по вектору с использованием безопасных параметризованных запросов.
   * Переход на $queryRaw гарантирует защиту от SQL-инъекций.
   */
  async findSimilarChunks(
    queryVector: number[],
    limit = 2,
  ): Promise<SearchResultChunk[]> {
    const vectorString = `[${queryVector.join(',')}]`;

    // Prisma $queryRaw экранирует vectorString и limit, исключая SQL-инъекции
    const chunks = await this.prisma.$queryRaw<SearchResultChunk[]>`
      SELECT id, content, source, (embedding <=> ${vectorString}::vector) as distance 
      FROM "DocumentChunk" 
      ORDER BY distance ASC 
      LIMIT ${limit}
    `;

    return chunks;
  }
}
