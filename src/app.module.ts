import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { BotUpdate } from './bot.update';
import { AiService } from './ai.service';
import { PrismaService } from './prisma.service';
import { DocumentService } from './document.service';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        token: configService.get<string>('TELEGRAM_BOT_TOKEN') || '',
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AdminController],
  providers: [
    BotUpdate,
    AiService,
    PrismaService,
    DocumentService,
    AdminService,
  ],
})
export class AppModule {}
