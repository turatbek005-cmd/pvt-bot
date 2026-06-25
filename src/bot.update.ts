import { Update, Start, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';

@Update()
export class BotUpdate {
  @Start()
  async onStart(@Ctx() ctx: Context) {
    const userName = ctx.from?.first_name || 'уважаемый гость';

    await ctx.reply(
      `Здравствуйте, ${userName}! 👋\n\n` +
        `Я официальный ИИ-ассистент Дирекции Парка Высоких Технологий КР.\n\n` +
        `Я могу ответить на ваши вопросы по законодательству ПВТ, налогам, уставу и порядку регистрации.\n\n` +
        `Чем я могу вам помочь?`,
    );
  }
}
