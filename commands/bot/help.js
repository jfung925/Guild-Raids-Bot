'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { PAGE_SIZE } = require('../../helpers/leaderboard.helper');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Explain the raid, wyvern, and bot commands.'),

  async execute(interaction) {
    await interaction.reply({
      content:
        '**/guildraids** — cumulative raids in this guild, '
        + PAGE_SIZE + ' members per page.\n'
        + '**/guildraids page:2** — the next page, when available.\n'
        + '**/guildraids days:7** — observed raid increases over the last seven days.\n'
        + '**/guildraids days:30 page:2** — the second page of a 30-day report.\n'
        + '**/guildraids scope:all** — current members\' guild raids across all guilds.\n'
        + '**/wyvern stats:<copied JSON>** — calculate level-1 feeding materials.\n'
        + '**/ping** — get called bald and see this server\'s saved /ping total.\n\n'
        + 'Use ← Previous / Next → to browse a report. '
        + 'Buttons belong to its requester and last 15 minutes or until a restart.\n\n'
        + 'The roster is loaded automatically. '
        + 'Unavailable means a count is missing or restricted. '
        + 'Without days, counts are cumulative. '
        + 'With days (1–365), saved history is required. '
        + 'Saved history survives restarts in the data folder. '
        + 'Background refresh continues when automatic posting is disabled. '
        + 'API caching can delay recent changes.',

      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};