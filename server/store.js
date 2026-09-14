/**
 * Простое хранилище статистики в JSON-файле.
 *
 * Нарочно без внешней БД: у мини-аппа нагрузка маленькая, а лишняя
 * зависимость усложнила бы деплой. Запись отложенная, чтобы не дёргать
 * диск на каждое событие.
 *
 * Важно: на Render (как и на большинстве бесплатных площадок) диск
 * контейнера очищается при передеплое. Чтобы статистика жила долго,
 * подключите Disk и укажите DB_PATH внутрь него.
 */

import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { users: {}, games: 0, updatedAt: null, startedAt: null };
    this.dirty = false;
    this.timer = null;
    this.load();

    if (!this.data.startedAt) {
      this.data.startedAt = Date.now();
      this.scheduleSave();
    }

    // Диск контейнера очищается при передеплое. Файл внутри папки проекта
    // уедет вместе с ней, а подключённый том монтируется рядом — снаружи.
    // Если этого не сказать, статистика будет молча обнуляться.
    const abs = path.resolve(filePath);
    this.persistent = !abs.startsWith(path.resolve(process.cwd()) + path.sep);
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this.data = { users: {}, games: 0, ...parsed };
      }
    } catch {
      // файла ещё нет — это нормально при первом запуске
    }
  }

  scheduleSave() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 3000);
    this.timer.unref?.();
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.data.updatedAt = new Date().toISOString();
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[store] не удалось сохранить статистику:', err.message);
    }
  }

  user(id) {
    const key = String(id);
    if (!this.data.users[key]) {
      this.data.users[key] = {
        id: Number(id), name: null, games: 0, wins: 0,
        asMafia: 0, asSheriff: 0, asDoctor: 0, asCivilian: 0,
        mafiaWins: 0, townWins: 0,
        firstSeen: null, lastSeen: null,
      };
    }
    return this.data.users[key];
  }

  /**
   * Отметить, что человек воспользовался ботом.
   * Считаем всех, кто хотя бы нажал «Старт», а не только доигравших партию.
   */
  touch(id, name, now = Date.now()) {
    const u = this.user(id);
    if (!u.firstSeen) u.firstSeen = now;
    u.lastSeen = now;
    if (name) u.name = name;
    this.scheduleSave();
    return u;
  }

  /** Сводка по аудитории для владельца бота. */
  overview(now = Date.now()) {
    const users = Object.values(this.data.users);
    const DAY = 86400000;
    const activeWithin = (days) =>
      users.filter((u) => u.lastSeen && now - u.lastSeen <= days * DAY).length;
    const newWithin = (days) =>
      users.filter((u) => u.firstSeen && now - u.firstSeen <= days * DAY).length;

    return {
      total: users.length,
      played: users.filter((u) => u.games > 0).length,
      games: this.data.games || 0,
      activeToday: activeWithin(1),
      activeWeek: activeWithin(7),
      activeMonth: activeWithin(30),
      newToday: newWithin(1),
      newWeek: newWithin(7),
      since: this.data.startedAt || null,
      persistent: this.persistent,
    };
  }

  /** Записать итог партии. */
  recordGame(game) {
    this.data.games = (this.data.games || 0) + 1;
    for (const p of game.playing) {
      if (!p.role) continue;
      if (p.isBot) continue; // у ботов нет и не должно быть статистики
      const u = this.user(p.id);
      u.name = p.name;
      u.games++;
      u.lastSeen = Date.now();
      if (!u.firstSeen) u.firstSeen = u.lastSeen;
      if (p.role === 'mafia') u.asMafia++;
      else if (p.role === 'sheriff') u.asSheriff++;
      else if (p.role === 'doctor') u.asDoctor = (u.asDoctor || 0) + 1;
      else u.asCivilian++;

      const won = (game.winner === 'mafia') === (p.role === 'mafia');
      if (won) {
        u.wins++;
        if (game.winner === 'mafia') u.mafiaWins++;
        else u.townWins++;
      }
    }
    this.scheduleSave();
  }

  statsFor(id) {
    const u = this.data.users[String(id)];
    if (!u) return { games: 0, wins: 0, asMafia: 0, asSheriff: 0, asCivilian: 0, winRate: 0 };
    return { ...u, winRate: u.games ? Math.round((u.wins / u.games) * 100) : 0 };
  }

  leaderboard(limit = 20) {
    return Object.values(this.data.users)
      .filter((u) => u.games >= 3)
      .sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games)
      .slice(0, limit)
      .map((u) => ({ id: u.id, name: u.name, games: u.games, wins: u.wins, winRate: Math.round((u.wins / u.games) * 100) }));
  }
}
