'use strict';

const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { safeName } = require('../../helpers/leaderboard.helper');
const { STATS, MAX_JSON_LENGTH, parseWyvern, calculateFeeding }
  = require('../../helpers/wyvern.helper');

const titleCase = text => text[0].toUpperCase() + text.slice(1);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wyvern')
    .setDescription('Calculate level-1 feeding materials from copied wyvern stats.')
    .addStringOption(option => option
      .setName('stats')
      .setDescription('Paste one complete in-game wyvern JSON export here.')
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(MAX_JSON_LENGTH)),

  async execute(interaction) {
    // Acknowledge before calculating. The reply is visible to the channel.
    await interaction.deferReply();

    const wyvern = parseWyvern(interaction.options.getString('stats', true));
    const plan = calculateFeeding(wyvern);

    // Show only the available color and potential above the stats.
    const details = [];
    if (wyvern.color) details.push('Color: ' + safeName(wyvern.color, 80));
    if (wyvern.potential !== null) details.push('Potential: ' + wyvern.potential);

    const rows = STATS.map((key, i) => {
      const stat = wyvern.stats[key];

      if (!stat) return '**' + titleCase(key) + ':** missing from export';

      return '**' + titleCase(key) + ':** level ' + stat.value
        + ' · limit ' + stat.limit + ' → ' + stat.maxValue
        + ' · needs +' + plan.need[i];
    });

    const foods = plan.materials.map(material => {
      const stacks = Math.floor(material.count / 64);
      const remainder = material.count % 64;
      const stackText = stacks > 0 ? ' (' + stacks + ' × 64 + ' + remainder + ')' : '';

      return '**' + material.count + ' × ' + material.name + '**' + stackText;
    });

    const embed = new EmbedBuilder()
      .setColor(0x8565C4)
      .addFields(
        {
          name: 'Imported stats',
          value: rows.join('\n'),
        },
        {
          name: 'Materials to feed — ' + plan.total + ' item(s)',
          value: foods.join('\n') || (wyvern.missing.length
            ? 'No additional feeding is needed for the reported stats.'
            : 'All eight feeding limits are already at their maximums.'),
        },
      );

    // Discord requires a nonempty description if one is included.
    if (details.length) embed.setDescription(details.join('\n'));

    if (wyvern.missing.length) {
      embed.addFields({
        name: 'Incomplete export',
        value:
          'Missing: ' + wyvern.missing.map(titleCase).join(', ') + '. '
          + 'This plan covers only the reported stats; it cannot confirm the whole wyvern is maxed.',
      });
    }

    if (plan.fallback) {
      embed.addFields({
        name: 'Plan quality',
        value:
          'Using a verified quick plan. It covers the required points but may use more materials.',
      });
    }

    // Escape player-supplied names and suppress every mention notification.
    await interaction.editReply({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  },
};