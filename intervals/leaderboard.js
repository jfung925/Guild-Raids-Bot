'use strict';

/**
 * Refresh the shared Wynncraft cache, then optionally update a Discord board.
 *
 * A channel ID of "0" disables automatic channel/message operations while the
 * refresh timer remains active. Schedule the next run after this one finishes.
 */
const { ChannelType } = require('discord.js');
const { buildLeaderboard } = require('../helpers/leaderboard.helper');

class LeaderboardTask {
  constructor({ client, settings, api, store, log, messageId = null }) {
    Object.assign(this, { client, settings, api, store, log, messageId });

    this.running = false;
    this.timer = null;
    this.inFlight = null;
  }

  async refresh() {
    // Reuse an active update so overlapping callers cannot create duplicate boards.
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.update();

    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  async update() {
    // This runs on startup and every interval, even when no one uses a command.
    // getGuild() shares its cache, pending request, and rate-limit backoff with
    // /guildraids. A recent command result may already be fresh enough to reuse.
    const snapshot = await this.api.getGuild();

    this.log.info('Guild data refreshed; ' + snapshot.members.length
      + ' members; API retrieved: ' + snapshot.retrievedAt + '.');

    // Channel "0" means background refresh only.
    // Return before looking up a channel, sending/editing a message, or saving
    // a leaderboard message ID.
    if (this.settings.channelId === '0') return;

    await this.publish(snapshot);
  }

  async publish(snapshot) {
    // Publishing uses the snapshot above and performs no additional Wynncraft call.
    // If the earlier API fetch failed, this method is never reached, preserving
    // the previous message and its successful retrieval timestamp.
    const channel = await this.client.channels.fetch(this.settings.channelId);

    if (
      !channel
      || channel.type !== ChannelType.GuildText
      || channel.guildId !== this.settings.serverId
    ) {
      throw new Error('LEADERBOARD_CHANNEL_ID must identify a regular text channel in DISCORD_SERVER_ID.');
    }

    const payload = {
      embeds: [buildLeaderboard(snapshot, { automatic: true })],
      allowedMentions: { parse: [] },
    };

    let message = null;

    if (this.messageId) {
      try {
        message = await channel.messages.fetch({
          message: this.messageId,
          cache: false,
          force: true,
        });
      } catch (error) {
        // Only Unknown Message means it was deleted. Permission/network errors
        // must not cause a replacement message on every interval.
        if (Number(error.code) !== 10008) throw error;

        this.messageId = null;
      }
    }

    if (message) {
      if (message.author.id !== this.client.user.id) {
        throw new Error('Saved board belongs to another user. Check leaderboard.json.');
      }

      await message.edit(payload);
    } else {
      message = await channel.send(payload);

      // Keep this ID in memory even if saving to disk fails.
      // A later update can then edit the same message.
      this.messageId = message.id;
    }

    await this.store.save(
      this.settings.serverId,
      this.settings.channelId,
      this.messageId
    );

    this.log.info('Leaderboard refreshed; '
      + snapshot.members.length + ' members returned.');
  }

  start() {
    // Calling start twice must not create two timers.
    if (this.running) return;

    this.running = true;

    // Perform the first refresh immediately.
    void this.tick();
  }

  async tick() {
    try {
      await this.refresh();
    } catch (error) {
      // A failed request is logged, and the next scheduled cycle tries again.
      this.log.warn('Scheduled guild update failed; will retry next interval.', error);
    } finally {
      // Schedule after completion so slow requests cannot overlap.
      if (this.running) {
        this.timer = setTimeout(() => {
          void this.tick();
        }, this.settings.refreshSeconds * 1000);
      }
    }
  }

  async stop() {
    this.running = false;
    clearTimeout(this.timer);

    // Let an active update finish before the bot disconnects.
    if (this.inFlight) {
      await this.inFlight.catch(() => {});
    }
  }
}

module.exports = { LeaderboardTask };