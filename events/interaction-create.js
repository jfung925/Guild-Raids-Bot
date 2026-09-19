'use strict';

/** Route slash commands and turn expected errors into useful Discord replies. */
const { Events, MessageFlags } = require('discord.js');
const { WynnError } = require('../helpers/wynn-api.helper');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, context) {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.guildId !== context.settings.serverId) {
      await interaction.reply({ content: 'Use this bot in its configured Discord server.',
        flags: MessageFlags.Ephemeral });
      return;
    }
    const command = context.commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: 'This command is not included in the raid bot.',
        flags: MessageFlags.Ephemeral });
      return;
    }
    try {
      await command.execute(interaction, context);
    } catch (error) {
      const expected = error instanceof WynnError || error instanceof RangeError;
      if (!expected) context.log.error('Command failed: ' + interaction.commandName, error);
      const reply = {
        content: expected ? error.message : 'The command failed. Check the hosting logs and channel permissions.',
        embeds: [], allowedMentions: { parse: [] },
      };
      // A deferred response must be edited; attempting a second initial reply fails.
      if (interaction.deferred || interaction.replied) await interaction.editReply(reply);
      else await interaction.reply({ ...reply, flags: MessageFlags.Ephemeral });
    }
  },
};
