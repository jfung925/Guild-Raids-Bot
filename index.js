'use strict';

/**
 * Entry file for Bot-Hosting.net: set STARTUP_FILE to index.js.
 * Flow: validate settings -> connect -> register commands -> start data refresh.
 * The optional shared Discord message is controlled separately by its channel ID.
 * API and configuration checks exit without logging in to Discord.
 */
const { Client, Events, GatewayIntentBits } = require('discord.js');
const { loadSettings } = require('./helpers/config.helper');
const { WynnClient, rankedMembers } = require('./helpers/wynn-api.helper');
const { BoardStore } = require('./helpers/state.helper');
const { createLogger } = require('./helpers/log.helper');
const { loadCommands, registerCommands } = require('./helpers/command.helper');
const interactionEvent = require('./events/interaction-create');
const { LeaderboardTask } = require('./intervals/leaderboard');
const { version } = require('./package.json');
const { RaidHistory, withHistory } = require('./helpers/history.helper');

async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('node index.js [--check-config | --check-api]\n'
      + 'Hosting panel: Entry File=index.js; RUN_MODE=bot, check-config, or check-api.');
    return;
  }

  if (args.length > 1 || args.some(arg => !['--check-config', '--check-api'].includes(arg))) {
    throw new Error('Use no arguments, --check-config, or --check-api.');
  }

  const [major, minor] = process.versions.node.split('.').map(Number);

  if (major < 24 || (major === 24 && minor < 17)) {
    throw new Error('Choose Node.js 24.17.0 or newer in the hosting runtime settings.');
  }

  const settings = loadSettings({ modeOverride: args[0]?.slice(2) });
  const log = createLogger(settings.token);

  log.info('Wynncraft Raid Bot ' + version + ' on Node.js '
    + process.versions.node + '; mode: ' + settings.mode + '.');

  const api = new WynnClient(settings.guildName);

  // Configuration checks exit without connecting to Discord.
  if (settings.mode === 'check-config') {
    log.info('Configuration format is valid. Token authenticity and permissions require a live connection.');
    return;
  }

  // API checks display a small preview, then exit.
  if (settings.mode === 'check-api') {
    const snapshot = await api.getGuild();
    const visible = snapshot.members.filter(member => member.current !== null).length;

    log.info('Guild: ' + snapshot.name + '; members: ' + snapshot.members.length
      + '; visible current-guild counts: ' + visible
      + '; unavailable: ' + (snapshot.members.length - visible));

    for (const member of rankedMembers(snapshot).slice(0, 5)) {
      log.info(member.username + ': ' + (member.current ?? 'Unavailable'));
    }

    log.info('API check complete. No connection to Discord was made.');
    return;
  }

  const commands = loadCommands();
  const store = new BoardStore(settings.statePath);
  let messageId = null;

  // Saved message state is needed only when automatic posting is enabled.
  if (settings.channelId !== '0') {
    // Refuse to start automatic posts with unreadable state or unwritable storage.
    messageId = await store.read(settings.serverId, settings.channelId);
    await store.checkWritable();
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    allowedMentions: { parse: [] },

    // Avoid blindly retrying message creation after an ambiguous server error.
    rest: { retries: 0, timeout: 20000 },
  });

    // Commands and background refreshes share the same history database.
  // The wrapper preserves the existing API cache and rate-limit handling.
  const history = new RaidHistory(settings);

  const context = {
    client,
    settings,
    commands,
    api: withHistory(api, history),
    store,
    log,
    history,
  };

  log.info(
    'Raid history enabled; saved in the data folder as raid-history.sqlite.'
  );
  let refreshTask = null;
  let closing = false;

  async function shutdown(exitCode) {
    if (closing) return;
    closing = true;

    log.info('Stopping the bot.');

    // Most stops finish quickly. The deadline prevents a stalled network request
    // from blocking the hosting panel's Stop action indefinitely.
    const deadline = setTimeout(() => process.exit(exitCode), 25000);
    deadline.unref();

    try {
      if (refreshTask) await refreshTask.stop();
      await client.destroy();
    } finally {
      // Close the history database after stopping background updates.
      history.close();
      clearTimeout(deadline);
      process.exitCode = exitCode;
    }
  }

  process.once('SIGTERM', () => { void shutdown(0); });
  process.once('SIGINT', () => { void shutdown(0); });

  client.on(interactionEvent.name, interaction => {
    void interactionEvent.execute(interaction, context)
      .catch(error => log.warn('Could not deliver the interaction response.', error));
  });

  client.on(Events.Error, error => {
    log.warn('Discord connection error.', error);
  });

  client.on(Events.ShardError, error => {
    log.warn('Discord Gateway connection error.', error);
  });

  client.once(Events.ClientReady, ready => {
    void (async () => {
      if (closing) return;

      await registerCommands(ready, commands, settings.serverId);

      if (closing) return;

      log.info('Registered ' + commands.size
        + ' command(s) in server ' + settings.serverId + '.');

      log.info('Connected as ' + ready.user.tag
        + '. Try /ping, then /guildraids.');

      // Always start background refresh in bot mode, including when channel=0.
      // The task checks the channel setting separately before accessing Discord.
      refreshTask = new LeaderboardTask({ ...context, messageId });

      log.info('Background guild refresh enabled; interval: '
        + settings.refreshSeconds + ' seconds.');

      if (settings.channelId === '0') {
        log.info('Automatic posting disabled; background refresh and commands are active.');
      }

      refreshTask.start();
    })().catch(async error => {
      log.error('Startup failed. Check the server ID, bot installation, and applications.commands scope.', error);
      await shutdown(1);
    });
  });

  try {
    await client.login(settings.token);
  } catch (error) {
    log.error('Discord login failed. Check the bot token and hosting connection.', error);
    await shutdown(1);
  }
}

// Requiring this file from a test does not start a bot or send any messages.
if (require.main === module) {
  main().catch(error => {
    // Configuration errors are deliberately written without embedding raw values.
    createLogger().error('Startup stopped.', error);
    process.exitCode = 1;
  });
}

module.exports = { main };