'use strict';

/**
 * Route slash commands and leaderboard page buttons.
 * Errors from button clicks must not erase the existing leaderboard.
 */
const { Events, MessageFlags } = require('discord.js');
const { WynnError } = require('../helpers/wynn-api.helper');

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction, context) {
    const button = interaction.isButton();
    const raidCommand = context.commands.get('guildraids');

    const pageButton =
      button && interaction.customId.startsWith('guildraids:');

    // Ignore interaction types that this handler does not manage.
    if (!interaction.isChatInputCommand() && !pageButton) {
      return;
    }

    if (interaction.guildId !== context.settings.serverId) {
      await interaction.reply({
        content: 'Use this bot in its configured Discord server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Handle leaderboard arrows separately from slash commands.
    if (pageButton) {
      try {
        if (!raidCommand?.executeButton) {
          await interaction.reply({
            content:
              'Run /guildraids again to create a new report.',
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
        } else {
          await raidCommand.executeButton(interaction);
        }
      } catch (error) {
        context.log.warn(
          'Could not change the leaderboard page.',
          error
        );

        const notice = {
          content:
            'Could not change pages. '
            + 'Try the button again or run /guildraids again.',
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        };

        // After deferUpdate(), editReply() would replace the leaderboard.
        // Use a private follow-up for errors to preserve the report.
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(notice);
        } else {
          await interaction.reply(notice);
        }
      }

      return;
    }

    // Handle normal slash commands, including /ping and /help.
    const command = context.commands.get(
      interaction.commandName
    );

    if (!command) {
      await interaction.reply({
        content: 'This command is not included in the raid bot.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await command.execute(interaction, context);
    } catch (error) {
      const expected =
        error instanceof WynnError
        || error instanceof RangeError;

      if (!expected) {
        context.log.error(
          'Command failed: ' + interaction.commandName,
          error
        );
      }

      const reply = {
        content: expected
          ? error.message
          : 'The command failed. Check the hosting logs and channel permissions.',
        embeds: [],
        components: [],
        allowedMentions: { parse: [] },
      };

      // A deferred command response must be edited.
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(reply);
      } else {
        await interaction.reply({
          ...reply,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};