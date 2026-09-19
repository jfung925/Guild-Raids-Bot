'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check whether the bot is responding.'),
  async execute(interaction) {
    // This checks Discord connectivity without using the Wynncraft API.
    await interaction.reply({ content: 'Enoki is bald.', flags: MessageFlags.Ephemeral });
  },
};
