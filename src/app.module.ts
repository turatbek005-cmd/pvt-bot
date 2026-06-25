import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { BotUpdate } from './bot.update';

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
  controllers: [],
  providers: [BotUpdate],
})
export class AppModule {}
