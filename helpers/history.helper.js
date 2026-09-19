'use strict';

/**
 * Persistent raid observations.
 *
 * Node.js 24 includes SQLite, so no additional npm package is needed.
 * Each fresh API response gets a timestamp. Member values are stored only
 * when they change, avoiding a full roster copy every five minutes.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DAY = 86400000;
const MAX_DAYS = 365;

// Discord displays these timestamps in each viewer's local timezone.
const stamp = milliseconds =>
  '<t:' + Math.floor(milliseconds / 1000) + ':f>';

class RaidHistory {
  constructor(settings) {
    const file = path.join(
      path.dirname(settings.statePath),
      'raid-history.sqlite'
    );

    fs.mkdirSync(path.dirname(file), { recursive: true });

    this.db = new DatabaseSync(file);
    this.guild = settings.guildName.trim().toLowerCase();

    // Allow normal request delays and brief outages.
    // With a five-minute refresh interval, this permits gaps up to 15 minutes.
    this.maxGap = Math.max(
      15 * 60000,
      settings.refreshSeconds * 2000 + 60000
    );

    try {
      this.db.exec(
        'PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;'
      );

      const version = this.db
        .prepare('PRAGMA user_version')
        .get().user_version;

      if (version !== 0 && version !== 1) {
        throw new Error('Unsupported raid history version.');
      }

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS samples (
          at INTEGER PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS latest (
          uuid TEXT PRIMARY KEY,
          present INTEGER NOT NULL,
          current INTEGER,
          all_count INTEGER,
          joined TEXT
        );

        CREATE TABLE IF NOT EXISTS changes (
          uuid TEXT NOT NULL,
          at INTEGER NOT NULL,
          present INTEGER NOT NULL,
          current INTEGER,
          all_count INTEGER,
          joined TEXT,
          PRIMARY KEY (uuid, at)
        ) WITHOUT ROWID;

        PRAGMA user_version=1;
      `);

      // Prevent a configuration change from mixing two guilds' histories.
      const savedGuild = this.db
        .prepare("SELECT value FROM meta WHERE key='guild'")
        .get();

      if (savedGuild && savedGuild.value !== this.guild) {
        throw new Error(
          'raid-history.sqlite belongs to another guild. '
          + 'Keep it as a backup and use a different dataDirectory.'
        );
      }

      this.db
        .prepare("INSERT OR IGNORE INTO meta VALUES ('guild', ?)")
        .run(this.guild);

      this.lastTime = this.db
        .prepare('SELECT MAX(at) AS at FROM samples')
        .get().at;

      this.lastPrune = Number(
        this.db
          .prepare("SELECT value FROM meta WHERE key='pruned'")
          .get()?.value ?? 0
      );

      this.insertChange = this.db.prepare(
        'INSERT INTO changes VALUES (?, ?, ?, ?, ?, ?)'
      );

      this.saveLatest = this.db.prepare(
        'INSERT OR REPLACE INTO latest VALUES (?, ?, ?, ?, ?)'
      );

      this.baseline = this.db.prepare(
        'SELECT * FROM changes '
        + 'WHERE uuid=? AND at<=? ORDER BY at DESC LIMIT 1'
      );

      this.after = this.db.prepare(
        'SELECT * FROM changes '
        + 'WHERE uuid=? AND at>? AND at<=? ORDER BY at'
      );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  record(snapshot) {
    if (snapshot.name.trim().toLowerCase() !== this.guild) {
      throw new Error(
        'The API guild does not match the raid history guild.'
      );
    }

    const at = Date.parse(snapshot.retrievedAt);

    if (!Number.isSafeInteger(at)) {
      throw new Error('Invalid raid snapshot timestamp.');
    }

    // Cached API responses retain their original timestamp.
    // Reusing cached data must not create a fake new observation.
    if (this.lastTime !== null && at <= this.lastTime) return;

    const previous = new Map(
      this.db
        .prepare('SELECT * FROM latest')
        .all()
        .map(row => [row.uuid, row])
    );

    const present = new Set(
      snapshot.members.map(member => member.uuid)
    );

    const save = (uuid, isPresent, current, all, joined) => {
      const old = previous.get(uuid);

      // Unchanged values need no additional history row.
      if (
        old
        && old.present === isPresent
        && old.current === current
        && old.all_count === all
        && old.joined === joined
      ) {
        return;
      }

      this.insertChange.run(
        uuid, at, isPresent, current, all, joined
      );

      this.saveLatest.run(
        uuid, isPresent, current, all, joined
      );
    };

    // Commit the timestamp and all member changes together.
    // A failed write must not leave a partially recorded roster.
    this.db.exec('BEGIN IMMEDIATE');

    try {
      const savedId = this.db
        .prepare("SELECT value FROM meta WHERE key='guild_uuid'")
        .get();

      if (
        savedId
        && snapshot.guildUuid
        && savedId.value !== snapshot.guildUuid
      ) {
        throw new Error(
          'The guild UUID changed. '
          + 'Use a different dataDirectory for this guild.'
        );
      }

      if (snapshot.guildUuid) {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO meta VALUES ('guild_uuid', ?)"
          )
          .run(snapshot.guildUuid);
      }

      this.db
        .prepare('INSERT INTO samples VALUES (?)')
        .run(at);

      for (const member of snapshot.members) {
        save(
          member.uuid,
          1,
          member.current,
          member.all,
          member.joinedAt ?? null
        );
      }

      // Record departures so a later rejoin cannot silently reuse
      // the previous membership's baseline.
      for (const old of previous.values()) {
        if (old.present && !present.has(old.uuid)) {
          save(old.uuid, 0, null, null, null);
        }
      }

      if (at - this.lastPrune >= DAY) {
        // Keep one year plus a boundary buffer.
        // Retain each member's necessary earlier baseline, including
        // members whose counts have remained unchanged for months.
        const cutoff = at - (MAX_DAYS + 1) * DAY;

        this.db.prepare(`
          DELETE FROM changes
          WHERE at < ? AND at < (
            SELECT MAX(older.at)
            FROM changes AS older
            WHERE older.uuid=changes.uuid AND older.at<=?
          )
        `).run(cutoff, cutoff);

        this.db.prepare(`
          DELETE FROM samples
          WHERE at < (
            SELECT MAX(at) FROM samples WHERE at<=?
          )
        `).run(cutoff);

        this.db
          .prepare(
            "INSERT OR REPLACE INTO meta VALUES ('pruned', ?)"
          )
          .run(String(at));
      }

      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // SQLite may already have rolled back the failed transaction.
      }

      throw error;
    }

    this.lastTime = at;

    if (at - this.lastPrune >= DAY) {
      this.lastPrune = at;
    }
  }

  compare(snapshot, days, scope = 'current') {
    if (
      !Number.isInteger(days)
      || days < 1
      || days > MAX_DAYS
    ) {
      throw new RangeError(
        'Choose a whole number of days from 1 to ' + MAX_DAYS + '.'
      );
    }

    if (!['current', 'all'].includes(scope)) {
      throw new RangeError('Choose current or all for scope.');
    }

    // A "day" means a rolling 24-hour period, ending at the latest
    // successful API retrieval time.
    const end = Date.parse(snapshot.retrievedAt);
    const target = end - days * DAY;

    // Select the nearest saved observation at or before the target.
    // The report displays the actual interval because polling cannot
    // provide the exact timestamp of every raid.
    const start = this.db
      .prepare('SELECT MAX(at) AS at FROM samples WHERE at<=?')
      .get(target).at;

    if (start === null) {
      const first = this.db
        .prepare('SELECT MIN(at) AS at FROM samples')
        .get().at;

      throw new RangeError(
        'Not enough saved history for ' + days + ' day(s). '
        + (
          first === null
            ? 'Wait for the first successful refresh.'
            : 'Tracking started ' + stamp(first)
              + '. A full window becomes available around '
              + stamp(first + days * DAY) + '.'
        )
        + ' Use /guildraids without days to see cumulative totals.'
      );
    }

    // Detect missing coverage, such as the bot being offline.
    const gap = this.db.prepare(`
      SELECT MAX(at - previous) AS gap
      FROM (
        SELECT
          at,
          LAG(at) OVER (ORDER BY at) AS previous
        FROM samples
        WHERE at>=? AND at<=?
      )
    `).get(start, end).gap ?? 0;

    if (
      target - start > this.maxGap
      || gap > this.maxGap
    ) {
      throw new RangeError(
        'The requested period contains a tracking gap longer than '
        + Math.round(this.maxGap / 60000)
        + ' minutes. A complete result is unavailable. '
        + 'Try a shorter period after continuous tracking resumes.'
      );
    }

    const field = scope === 'current' ? 'current' : 'all_count';

    const members = snapshot.members.map(member => {
      const base = this.baseline.get(member.uuid, start);
      let previous = base;
      let valid = Boolean(base?.present && base[field] !== null);

      for (
        const row of this.after.iterate(member.uuid, start, end)
      ) {
        // Never subtract across missing/private data, departures,
        // changed join dates, or an observed counter decrease.
        // A counter recovering later does not erase that uncertainty.
        if (
          !row.present
          || row[field] === null
          || !previous
          || previous[field] === null
          || row[field] < previous[field]
          || row.joined !== previous.joined
        ) {
          valid = false;
        }

        previous = row;
      }

      valid = valid
        && member[scope] !== null
        && previous[field] === member[scope]
        && previous.joined === (member.joinedAt ?? null);

      const increase = valid
        ? member[scope] - base[field]
        : null;

      return {
        ...member,
        current: scope === 'current' ? increase : null,
        all: scope === 'all' ? increase : null,
      };
    });

    return {
      snapshot: { ...snapshot, members },
      start,
      end,
      days,
    };
  }

  close() {
    this.db.close();
  }
}

/**
 * Both commands and background refreshes use this wrapper.
 * The original API client still controls caching and rate-limit backoff.
 */
function withHistory(api, history) {
  return {
    async getGuild() {
      const snapshot = await api.getGuild();
      history.record(snapshot);
      return snapshot;
    },
  };
}

module.exports = {
  RaidHistory,
  withHistory,
  MAX_DAYS,
  DAY,
  stamp,
};