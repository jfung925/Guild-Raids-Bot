'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { MessageFlags, SlashCommandBuilder } = require('discord.js');

/** Add one use to this server's saved /ping total and return the new total. */
function incrementPingCount(settings, serverId) {
  // Use the existing dataDirectory setting. This normally creates
  // data/ping-counts.sqlite automatically, beside the bot's other saved data.
  const file = path.join(
    path.dirname(settings.statePath),
    'ping-counts.sqlite'
  );

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  try {
    // Keep writes durable and allow a short wait if the file is briefly busy.
    db.exec('PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL;');

    db.exec(`
      CREATE TABLE IF NOT EXISTS ping_counts (
        server_id TEXT PRIMARY KEY,
        total INTEGER NOT NULL CHECK (
          typeof(total) = 'integer' AND total >= 0
        )
      );
    `);

    // One atomic statement creates the counter at 1 or increments it.
    // Closely timed commands cannot overwrite each other's increments.
    const statement = db.prepare(`
      INSERT INTO ping_counts (server_id, total) VALUES (?, 1)
      ON CONFLICT(server_id) DO UPDATE SET total = ping_counts.total + 1
      RETURNING total;
    `);

    statement.setReadBigInts(true);
    return statement.get(serverId).total;
  } finally {
    // The total stays on disk after closing the connection or restarting.
    db.close();
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Get called bald and see the server\'s /ping count.'),

  async execute(interaction, context) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'Use /ping inside the Discord server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Acknowledge immediately and make the reply visible to the channel.
    await interaction.deferReply();

    // This is the shared server total, including the command just used.
    // A failed save is handled by the bot's existing command error handler.
    const count = incrementPingCount(
      context.settings,
      interaction.guildId
    );

    const times = count === 1n ? 'time' : 'times';

    await interaction.editReply({
      // The interaction already identifies the caller: no member lookup needed.
      content: `<@${interaction.user.id}> is bald.\n`
        + `This command has been run ${count.toLocaleString('en-US')} ${times}.`,

      // Display the caller's Discord name without sending a mention notification.
      allowedMentions: { parse: [] },
    });
  },
};