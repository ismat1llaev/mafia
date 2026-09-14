/**
 * Телеграм-бот @MafiaGameGGbot.
 *
 * Бот здесь — «дверь» в мини-апп: приветствие, кнопка запуска,
 * приглашения в комнату и статистика. Сама игра живёт внутри мини-аппа.
 */

import { Bot, InlineKeyboard } from 'grammy';

/**
 * Правила одним текстом. Их же бот закрепляет в личке каждому игроку,
 * чтобы во время партии не искать, кто что умеет.
 */
export const RULES_TEXT = [
  '🎭 *Правила мафии*',
  '',
  '*Роли*',
  '🔫 _Мафия_ — знает своих, ночью выбирает жертву.',
  '💉 _Доктор_ — ночью спасает одного игрока. Если мафия пришла за ним, он выживает. Одного и того же нельзя лечить две ночи подряд, себя — можно.',
  '🔎 _Комиссар_ — проверяет одного игрока за ночь: мафия или нет. Включается по желанию комнаты.',
  '👤 _Мирный житель_ — ночных способностей нет, ищет мафию обсуждением.',
  '',
  '*Состав*',
  'Мафии примерно треть от числа игроков: 5 игроков — 1 мафия, 6–8 — 2, 9–11 — 3, 12 — 4. Доктор и комиссар — по одному, включаются в настройках комнаты. Остальные — мирные.',
  '',
  '*Ход игры*',
  '🌙 _Ночь_ — мафия договаривается в тайном чате и выбирает жертву, доктор кого-то спасает, комиссар проверяет игрока.',
  '🌅 _Утро_ — объявляется, кто погиб.',
  '💬 _Обсуждение_ — все живые ищут мафию.',
  '🗳 _Голосование_ — набравший большинство выбывает. При равенстве — переголосовка между лидерами.',
  '',
  '*Победа*',
  '🏙 Мирные — когда мафии не осталось.',
  '🔫 Мафия — когда мафиози столько же, сколько мирных, или больше.',
  '',
  '_Обсуждать удобнее голосом: включите звонок в Telegram и играйте параллельно._',
].join('\n');

export function buildBot({
  token, publicUrl, botUsername, appShortName, channelUrl, store,
  isOwner = async () => false,
}) {
  const bot = new Bot(token);

  /** Ссылка, открывающая мини-апп (при необходимости — сразу на комнату). */
  const appUrl = (code) => (code ? `${publicUrl}/?code=${encodeURIComponent(code)}` : `${publicUrl}/`);

  /** Ссылка вида t.me/... — её можно пересылать в группы и чаты. */
  const shareUrl = (code) => {
    if (botUsername && appShortName) {
      return `https://t.me/${botUsername}/${appShortName}?startapp=${encodeURIComponent(code)}`;
    }
    if (botUsername) {
      return `https://t.me/${botUsername}?start=room_${encodeURIComponent(code)}`;
    }
    return appUrl(code);
  };

  const startText = [
    '🎭 *Мафия*',
    '',
    'Классическая игра для компании 5–12 человек прямо в Telegram.',
    '',
    '*Как играть*',
    '1. Один человек создаёт комнату и получает код из 5 символов.',
    '2. Остальные вводят этот код или переходят по ссылке-приглашению.',
    '3. Бот раздаёт роли: мафия, комиссар, мирные жители.',
    '4. Ночью мафия выбирает жертву, комиссар проверяет одного игрока.',
    '5. Днём город обсуждает и голосует.',
    '',
    'Мирные побеждают, когда вся мафия выведена из игры. Мафия — когда её становится не меньше, чем мирных.',
    '',
    'Обсуждать удобнее голосом — включите звонок в Telegram и играйте параллельно.',
    ...(channelUrl ? ['', `📣 [Новости и обновления игры](${channelUrl})`] : []),
  ].join('\n');

  bot.command('start', async (ctx) => {
    // Считаем каждого, кто хотя бы открыл бота
    store.touch(ctx.from.id, [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '));

    const payload = ctx.match?.trim();
    const roomCode = payload?.startsWith('room_') ? payload.slice(5).toUpperCase() : null;

    if (roomCode) {
      await ctx.reply(
        `Вас пригласили в комнату *${roomCode}*.\nНажмите кнопку ниже, чтобы присоединиться.`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().webApp(`🎭 Войти в комнату ${roomCode}`, appUrl(roomCode)),
        },
      );
      return;
    }

    // remove_keyboard убирает старую клавиатуру под полем ввода: её кнопки
    // открывали мини-приложение без данных пользователя, и вход не проходил.
    await ctx.reply(startText, {
      parse_mode: 'Markdown',
      reply_markup: { remove_keyboard: true },
    });

    await ctx.reply('Готовы? Жмите кнопку 👇', {
      reply_markup: new InlineKeyboard().webApp('🎭 Играть в мафию', appUrl()),
    });
  });

  bot.command('play', async (ctx) => {
    await ctx.reply('Открываю игру:', {
      reply_markup: new InlineKeyboard().webApp('🎭 Играть', appUrl()),
    });
  });

  bot.command('rules', async (ctx) => {
    await ctx.reply(RULES_TEXT, { parse_mode: 'Markdown' });
  });

  bot.command('stats', async (ctx) => {
    const s = store.statsFor(ctx.from.id);
    if (!s.games) {
      await ctx.reply('Вы ещё не сыграли ни одной партии. Самое время начать!', {
        reply_markup: new InlineKeyboard().webApp('🎭 Играть', appUrl()),
      });
      return;
    }
    await ctx.reply(
      [
        `*Статистика ${ctx.from.first_name}*`,
        '',
        `Партий сыграно: ${s.games}`,
        `Побед: ${s.wins} (${s.winRate}%)`,
        '',
        `За мафию: ${s.asMafia}`,
        `За комиссара: ${s.asSheriff}`,
        `За мирных: ${s.asCivilian}`,
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('top', async (ctx) => {
    const top = store.leaderboard(10);
    if (!top.length) {
      await ctx.reply('Рейтинг пока пуст — нужно минимум 3 партии, чтобы попасть в него.');
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const lines = top.map((u, i) => `${medals[i] || `${i + 1}.`} ${u.name || 'Игрок'} — ${u.winRate}% (${u.games} партий)`);
    await ctx.reply(['*Топ игроков*', '', ...lines].join('\n'), { parse_mode: 'Markdown' });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '/play — открыть игру',
        '/rules — правила',
        '/stats — моя статистика',
        '/top — рейтинг игроков',
        '',
        'Чтобы позвать друзей, создайте комнату в приложении и нажмите «Пригласить» — бот подготовит ссылку, которую можно переслать в любой чат.',
      ].join('\n'),
    );
  });

  // Приглашение через inline-режим: набрать «@MafiaGameGGbot КОД» в любом чате
  bot.command('myid', async (ctx) => {
    await ctx.reply(
      `Ваш Telegram id: <code>${ctx.from.id}</code>\n\nОн нужен для переменной OWNER_ID на сервере.`,
      { parse_mode: 'HTML' },
    );
  });

  bot.command('users', async (ctx) => {
    if (!(await isOwner(ctx.from.id))) {
      await ctx.reply('Эта команда только для владельца бота.');
      return;
    }

    const o = store.overview();
    const since = o.since
      ? new Date(o.since).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'неизвестно';

    const lines = [
      '👥 <b>Аудитория бота</b>',
      '',
      `Всего людей: <b>${o.total}</b>`,
      `Из них сыграли хотя бы партию: <b>${o.played}</b>`,
      `Партий сыграно: <b>${o.games}</b>`,
      '',
      '<b>Активность</b>',
      `Сегодня заходили: ${o.activeToday}`,
      `За неделю: ${o.activeWeek}`,
      `За месяц: ${o.activeMonth}`,
      '',
      '<b>Новые</b>',
      `Сегодня: ${o.newToday}`,
      `За неделю: ${o.newWeek}`,
      '',
      `Счёт ведётся с ${since}`,
    ];

    if (!o.persistent) {
      lines.push(
        '',
        '⚠️ <b>Цифры обнулятся при следующем обновлении.</b>',
        'Статистика лежит внутри папки приложения, а она пересоздаётся при каждом деплое.',
        'Чтобы числа копились, подключите на Railway том (Volume) и укажите путь к нему в переменной DB_PATH.',
      );
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  bot.on('inline_query', async (ctx) => {
    const code = ctx.inlineQuery.query.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    const title = code ? `Пригласить в комнату ${code}` : 'Позвать играть в мафию';
    const text = code
      ? `🎭 Играем в мафию! Комната *${code}*.\nЖми кнопку, чтобы присоединиться.`
      : '🎭 Играем в мафию! Присоединяйся.';

    await ctx.answerInlineQuery(
      [
        {
          type: 'article',
          id: code || 'open',
          title,
          description: code ? 'Отправит приглашение с кнопкой входа' : 'Отправит ссылку на игру',
          input_message_content: { message_text: text, parse_mode: 'Markdown' },
          reply_markup: new InlineKeyboard().url(
            code ? `🎭 Войти в комнату ${code}` : '🎭 Играть в мафию',
            shareUrl(code || ''),
          ),
        },
      ],
      { cache_time: 5, is_personal: true },
    );
  });

  bot.catch((err) => {
    console.error('[bot] ошибка:', err.error?.message || err.message);
  });

  /** Настроить меню и команды. Вызывается один раз при старте. */
  async function configure() {
    try {
      await bot.api.setMyCommands([
        { command: 'play', description: 'Открыть игру' },
        { command: 'rules', description: 'Правила' },
        { command: 'stats', description: 'Моя статистика' },
        { command: 'top', description: 'Рейтинг игроков' },
        { command: 'help', description: 'Помощь' },
        { command: 'users', description: 'Аудитория бота (для владельца)' },
      ]);
      await bot.api.setChatMenuButton({
        menu_button: { type: 'web_app', text: 'Мафия', web_app: { url: appUrl() } },
      });
      console.log('[bot] команды и кнопка меню настроены');
    } catch (err) {
      console.error('[bot] не удалось настроить меню:', err.message);
    }
  }

  return { bot, configure, appUrl, shareUrl };
}

/**
 * Отдельный бот для канала.
 *
 * Нужен, когда посты должны выходить не от игрового бота, а от своего —
 * с другим именем и аватаркой. Игры он не знает: только публикует и
 * принимает команды управления очередью.
 */
export function buildChannelBot({ token, channelUrl, playUrl }) {
  const bot = new Bot(token);

  const intro = [
    '📣 <b>Бот канала «Мафия»</b>',
    '',
    'Я публикую посты в канал по расписанию. В игру играют не здесь —',
    'для этого есть игровой бот.',
    '',
    'Команды управления доступны администраторам канала:',
    '/kanal — очередь постов и когда выйдет следующий',
    '/postnow — опубликовать следующий сейчас',
    '/pause и /resume — приостановить и продолжить',
    '/addpost — добавить свой пост',
  ].join('\n');

  bot.command(['start', 'help'], async (ctx) => {
    const keyboard = new InlineKeyboard();
    if (playUrl) keyboard.url('🎭 Играть в мафию', playUrl);
    if (channelUrl) keyboard.row().url('📣 Наш канал', channelUrl);

    await ctx.reply(intro, {
      parse_mode: 'HTML',
      reply_markup: keyboard.inline_keyboard.length ? keyboard : undefined,
    });
  });

  bot.catch((err) => {
    console.error('[канал-бот] ошибка:', err.error?.message || err.message);
  });

  async function configure() {
    try {
      await bot.api.setMyCommands([
        { command: 'kanal', description: 'Очередь постов' },
        { command: 'postnow', description: 'Опубликовать сейчас' },
        { command: 'pause', description: 'Приостановить' },
        { command: 'resume', description: 'Продолжить' },
        { command: 'addpost', description: 'Добавить свой пост' },
      ]);
      console.log('[канал-бот] команды настроены');
    } catch (err) {
      console.error('[канал-бот] не удалось настроить команды:', err.message);
    }
  }

  return { bot, configure };
}

/**
 * Команды управления каналом. Доступны только администраторам самого канала —
 * отдельный список владельцев вести не нужно, права берутся из Telegram.
 */
export function registerChannelCommands({ bot, publisher, channelId }) {
  const denied = 'Эта команда только для администраторов канала.';

  async function isChannelAdmin(userId) {
    if (!channelId) return false;
    try {
      const member = await bot.api.getChatMember(channelId, userId);
      return member.status === 'creator' || member.status === 'administrator';
    } catch {
      return false;
    }
  }

  /** Обёртка: проверяет права и подключённость канала. */
  const adminOnly = (handler) => async (ctx) => {
    if (!publisher.enabled) {
      await ctx.reply('Канал не подключён. Задайте переменную CHANNEL_ID на сервере.');
      return;
    }
    if (!(await isChannelAdmin(ctx.from.id))) {
      await ctx.reply(denied);
      return;
    }
    await handler(ctx);
  };

  bot.command('kanal', adminOnly(async (ctx) => {
    const state = publisher.state();
    const next = publisher.nextPost();
    await ctx.reply(
      [
        '📣 <b>Автопубликация в канал</b>',
        '',
        `Состояние: ${state.paused ? '⏸ на паузе' : '▶️ работает'}`,
        `Осталось постов: ${publisher.remaining()}`,
        `Следующий выход: ${publisher.nextRunDescription()}`,
        next ? `Следующий пост: «${next.title}»` : 'Очередь пуста',
        '',
        '<b>Команды</b>',
        '/postnow — опубликовать следующий прямо сейчас',
        '/pause — приостановить',
        '/resume — продолжить',
        '/addpost — добавить свой пост в конец очереди',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  }));

  bot.command('postnow', adminOnly(async (ctx) => {
    const res = await publisher.publishNext();
    if (res.ok) {
      await ctx.reply(`✅ Опубликовано: «${res.post.title}»\nОсталось в очереди: ${res.remaining}`);
    } else {
      await ctx.reply(`Не получилось: ${res.error}`);
    }
  }));

  bot.command('pause', adminOnly(async (ctx) => {
    publisher.setPaused(true);
    await ctx.reply('⏸ Автопубликация приостановлена. Вернуть — /resume');
  }));

  bot.command('resume', adminOnly(async (ctx) => {
    publisher.setPaused(false);
    await ctx.reply(`▶️ Автопубликация включена. Следующий выход: ${publisher.nextRunDescription()}`);
  }));

  bot.command('addpost', adminOnly(async (ctx) => {
    // Текст берём либо после команды, либо из сообщения, на которое ответили
    const inline = ctx.match?.trim();
    const replied = ctx.message?.reply_to_message?.text;
    const text = inline || replied;

    if (!text) {
      await ctx.reply(
        [
          'Как добавить пост:',
          '',
          '1. Напишите /addpost и сразу текст поста в том же сообщении.',
          '2. Или пришлите текст, ответьте на него командой /addpost.',
          '',
          'Пост встанет в конец очереди и выйдет своим чередом.',
        ].join('\n'),
      );
      return;
    }

    const res = publisher.addPost(text);
    if (res.ok) {
      await ctx.reply(`✅ Пост добавлен. Теперь в очереди: ${res.remaining}`);
    } else {
      await ctx.reply(`Не получилось: ${res.error}`);
    }
  }));
}
