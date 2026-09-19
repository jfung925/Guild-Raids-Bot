'use strict';

/** Each command exports data (its slash definition) and execute (its handler). */
const fs = require('node:fs');
const path = require('node:path');
const { Collection } = require('discord.js');

function loadCommands(directory = path.resolve(__dirname, '..', 'commands')) {
  const commands = new Collection();
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        const command = require(fullPath);
        if (!command.data?.toJSON || typeof command.execute !== 'function') {
          throw new Error('Invalid command module: ' + entry.name);
        }
        const name = command.data.toJSON().name;
        if (commands.has(name)) throw new Error('Duplicate slash command: ' + name);
        commands.set(name, command);
      }
    }
  }
  visit(directory);
  return commands;
}

async function registerCommands(client, commands, serverId) {
  // Upsert our commands in one server. Do not bulk-delete unrelated commands
  // that may already belong to this Discord application.
  for (const command of commands.values()) {
    await client.application.commands.create(command.data.toJSON(), serverId);
  }
}

module.exports = { loadCommands, registerCommands };
