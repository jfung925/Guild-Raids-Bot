'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { buildLeaderboard } = require('../../helpers/leaderboard.helper');
const { MAX_DAYS, stamp } = require('../../helpers/history.helper');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('guildraids')
    .setDescription('Show the Wynncraft guild raid leaderboard.')

    .addIntegerOption(option =>
      option
        .setName('days')
        .setDescription(
          'Raid increase over the last X days; omit for cumulative totals.'
        )
        .setMinValue(1)
        .setMaxValue(MAX_DAYS)
    )

    .addIntegerOption(option =>
      option
        .setName('page')
        .setDescription('Page number: 25 members per page.')
        .setMinValue(1)
    )

    .addStringOption(option =>
      option
        .setName('scope')
        .setDescription('Choose raids in this guild or across all guilds.')
        .addChoices(
          {
            name: 'Raids in this guild',
            value: 'current',
          },
          {
            name: 'Guild raids across all guilds',
            value: 'all',
          }
        )
    ),

  async execute(interaction, { api, history }) {
    // Acknowledge first so API/database work does not time out the command.
    await interaction.deferReply();

    // This shared API wrapper also records fresh observations.
    const snapshot = await api.getGuild();

    const days = interaction.options.getInteger('days');
    const page = interaction.options.getInteger('page') ?? 1;
    const scope = interaction.options.getString('scope') ?? 'current';

    // Without days, preserve the existing cumulative leaderboard.
    const period = days === null
      ? null
      : history.compare(snapshot, days, scope);

    const embed = buildLeaderboard(
      period?.snapshot ?? snapshot,
      { page, scope }
    );

    if (period) {
      embed
        .setTitle(
          embed.data.title + ' | Last ' + days + ' day(s)'
        )
        .addFields(
          {
            name: 'Measured interval',
            value: stamp(period.start) + ' → ' + stamp(period.end),
          },
          {
            name: 'Reading these counts',
            value:
              'Increases between saved API observations for current members. '
              + 'Unavailable means missing history, hidden counts, '
              + 'or a detected reset/membership change. '
              + 'Polling and API caching make the period approximate.',
          }
        )
        .setFooter({
          text: embed.data.footer.text.replace(
            'Cumulative counts',
            'Observed increases'
          ),
        });
    }

    await interaction.editReply({
      content: null,
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  },
};