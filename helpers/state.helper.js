'use strict';

/** Preserve the automatic board's message ID across process restarts. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { isDiscordId } = require('./config.helper');

class BoardStore {
  constructor(file) {
    this.file = file;
  }

  async read(serverId, channelId) {
    let text;
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error('Cannot read leaderboard.json. Check DATA_DIR and its permissions.');
    }
    let record;
    try {
      // The earlier Python starter stored IDs as JSON numbers. Node 24's source
      // context recovers their original digits before rounded Number values leak
      // into our state. New records always write IDs as quoted strings.
      record = JSON.parse(text, (key, value, context) => {
        if (['server_id', 'channel_id', 'message_id'].includes(key) && typeof value === 'number') {
          return context.source;
        }
        return value;
      });
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error();
      if (record.version === undefined && record.server_id !== undefined) {
        record = { version: 1, serverId: record.server_id,
          channelId: record.channel_id, messageId: record.message_id };
      }
      if (record.version !== 1 || ![record.serverId, record.channelId, record.messageId].every(isDiscordId)) {
        throw new Error();
      }
    } catch {
      // Do not erase damaged state: that could silently create duplicate boards.
      throw new Error('leaderboard.json is damaged or unsupported. Follow the recovery steps in CLOUD_SETUP.md.');
    }
    return record.serverId === serverId && record.channelId === channelId ? record.messageId : null;
  }

  async checkWritable() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const probe = this.file + '.probe-' + process.pid;
    await fs.writeFile(probe, '', { mode: 0o600 });
    await fs.unlink(probe);
  }

  async save(serverId, channelId, messageId) {
    if (![serverId, channelId, messageId].every(isDiscordId)) throw new Error('Cannot save invalid Discord IDs.');
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp-' + process.pid;
    const contents = JSON.stringify({ version: 1, serverId, channelId, messageId }, null, 2) + '\n';
    try {
      await fs.writeFile(temporary, contents, { mode: 0o600 });
      // Rename in the same directory prevents a partially written JSON file.
      await fs.rename(temporary, this.file);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }
}

module.exports = { BoardStore };
