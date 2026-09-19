'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Explain the raid leaderboard commands.'),

  async execute(interaction) {
    await interaction.reply({
      content:
        '**/guildraids** — cumulative raids in this guild, 25 members per page.\n'
        + '**/guildraids page:2** — the next page, when available.\n'
        + '**/guildraids days:7** — observed raid increases over the last seven days.\n'
        + '**/guildraids days:30 page:2** — the second page of a 30-day report.\n'
        + '**/guildraids scope:all** — current members\' guild raids across all guilds.\n'
        + '**/ping** — check the bot connection.\n\n'
        + 'The roster is loaded automatically. '
        + 'Unavailable means a count is missing or restricted. '
        + 'Without days, counts are cumulative. '
        + 'With days (1–365), saved history is required. '
        + 'Tracking begins when this update is installed '
        + 'and survives restarts in the data folder. '
        + 'API caching can delay recent changes.',

      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};