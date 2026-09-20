'use strict';

/** Format snapshots for Discord. This module performs no network requests. */
const { EmbedBuilder, escapeMarkdown } = require('discord.js');
const { rankedMembers } = require('./wynn-api.helper');

const PAGE_SIZE = 10;

function safeName(name, length = 40) {
  // Names come from an external API. Escape formatting and neutralize mentions.
  return escapeMarkdown(
    String(name).replace(/[\r\n\t]/g, ' ').slice(0, length)
  ).replace(/@/g, '@\u200b');
}

function buildLeaderboard(
  snapshot,
  { scope = 'current', page = 1, automatic = false } = {}
) {
  const members = rankedMembers(snapshot, scope);
  const pages = Math.max(1, Math.ceil(members.length / PAGE_SIZE));

  if (!Number.isInteger(page) || page < 1 || page > pages) {
    throw new RangeError('Choose a page from 1 to ' + pages + '.');
  }

  const offset = (page - 1) * PAGE_SIZE;

  const lines = members
    .slice(offset, offset + PAGE_SIZE)
    .map((member, index) => {
      const count = member[scope] === null
        ? 'Unavailable'
        : member[scope].toLocaleString('en-US');

      return '**' + (offset + index + 1) + '.** '
        + safeName(member.username, 32)
        + ' — **' + count + '**';
    });

  const visible = members.filter(
    member => member[scope] !== null
  ).length;

  const label = scope === 'current'
    ? 'Raids in this guild'
    : 'Guild raids across all guilds';

  const hint = automatic
    ? ' · Use /guildraids for all pages'
    : '';

  return new EmbedBuilder()
    .setColor(0x2E8B72)
    .setTitle(safeName(snapshot.name) + ' | ' + label)
    .setDescription(
      lines.join('\n') || 'No members were returned by the API.'
    )
    .addFields({
      name: 'Coverage',
      value: members.length + ' members · '
        + visible + ' visible counts · '
        + (members.length - visible) + ' unavailable',
    })
    // Show when the API data was successfully retrieved.
    .setTimestamp(new Date(snapshot.retrievedAt))
    .setFooter({
      text: 'Page ' + page + '/' + pages + hint
        + ' · Cumulative counts · API retrieved',
    });
}

module.exports = { PAGE_SIZE, buildLeaderboard, safeName };