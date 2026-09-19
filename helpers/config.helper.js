'use strict';

/**
 * Read all user settings in one place.
 * Priority: host environment > local .env > config.json > defaults.
 * Nothing here connects to Discord or changes configuration files.
 */
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const ROOT = path.resolve(__dirname, '..');
const SNOWFLAKE = /^[1-9]\d{16,19}$/;

function isDiscordId(value) {
  // Discord IDs exceed JavaScript's exact Number range. Keep them as strings.
  return typeof value === 'string' && SNOWFLAKE.test(value)
    && BigInt(value) <= 18446744073709551615n;
}

function readOptional(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Cannot read ' + path.basename(file) + '. Check file permissions.');
  }
}

function loadSettings({ root = ROOT, env = process.env, modeOverride } = {}) {
  const configText = readOptional(path.join(root, 'config.json'));
  let file = {};
  if (configText !== null) {
    try {
      file = JSON.parse(configText);
      if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error();
    } catch {
      // Parser errors can quote source text, including a token. Hide that text.
      throw new Error('config.json must be a valid JSON object. Check commas and double quotes.');
    }
  }
  const dotenvText = readOptional(path.join(root, '.env'));
  const variables = { ...(dotenvText === null ? {} : dotenv.parse(dotenvText)), ...env };
  const value = (envKey, jsonKey, fallback) => variables[envKey] ?? file[jsonKey] ?? fallback;
  const text = (envKey, jsonKey, fallback = '') => {
    const result = value(envKey, jsonKey, fallback);
    if (typeof result !== 'string') {
      throw new Error(envKey + ' must be text. Put Discord IDs in double quotes in config.json.');
    }
    return result.trim();
  };

  const mode = modeOverride ?? text('RUN_MODE', 'mode', 'bot');
  if (!['bot', 'check-api', 'check-config'].includes(mode)) {
    throw new Error('RUN_MODE must be bot, check-api, or check-config.');
  }
  const guildName = text('WYNN_GUILD_NAME', 'guildName');
  if (!guildName || guildName === 'PUT_YOUR_FULL_GUILD_NAME_HERE') {
    throw new Error('Set WYNN_GUILD_NAME or config.json guildName to your full in-game guild name.');
  }
  const token = text('DISCORD_TOKEN', 'token');
  const serverId = text('DISCORD_SERVER_ID', 'discordServerId', '0');
  const channelId = text('LEADERBOARD_CHANNEL_ID', 'leaderboardChannelId', '0');

  // API diagnostics require only a guild name. Normal startup also needs Discord.
  if (mode !== 'check-api') {
    if (!token || token === 'PASTE_YOUR_BOT_TOKEN_HERE' || /\s/.test(token)) {
      throw new Error('Set DISCORD_TOKEN or config.json token to the Discord bot token.');
    }
    if (!isDiscordId(serverId)) {
      throw new Error('DISCORD_SERVER_ID must be your Discord server ID, stored as text.');
    }
  }
  if (channelId !== '0' && !isDiscordId(channelId)) {
    throw new Error('LEADERBOARD_CHANNEL_ID must be 0 or a Discord text-channel ID.');
  }

  const rawRefresh = value('REFRESH_SECONDS', 'refreshSeconds', 300);
  if (!/^[0-9]+$/.test(String(rawRefresh))) {
    throw new Error('REFRESH_SECONDS must be a whole number of seconds.');
  }
  const refreshSeconds = Number(rawRefresh);
  if (!Number.isSafeInteger(refreshSeconds) || refreshSeconds < 120 || refreshSeconds > 86400) {
    throw new Error('REFRESH_SECONDS must be between 120 and 86400. Use 300 for five minutes.');
  }
  const dataDirectory = text('DATA_DIR', 'dataDirectory', 'data');
  if (!dataDirectory) throw new Error('DATA_DIR must name a writable folder. Use data for this host.');

  const settings = {
    guildName, serverId, channelId, refreshSeconds, mode,
    statePath: path.resolve(root, dataDirectory, 'leaderboard.json'),
  };
  // Accidental JSON.stringify(settings) should never reveal the bot password.
  Object.defineProperty(settings, 'token', { value: token, enumerable: false });
  return Object.freeze(settings);
}

module.exports = { ROOT, isDiscordId, loadSettings };
