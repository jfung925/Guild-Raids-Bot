'use strict';

const { randomBytes } = require('node:crypto');

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');

const {
  buildLeaderboard,
  PAGE_SIZE,
} = require('../../helpers/leaderboard.helper');

const {
  MAX_DAYS,
  stamp,
} = require('../../helpers/history.helper');

// Keep each report's pages together so its rankings, scope, and dates
// do not change while someone browses.
//
// These temporary reports are separate from the saved raid history.
const BUTTON_PREFIX = 'guildraids:';
const BUTTON_LIFETIME = 15 * 60 * 1000;
const MAX_REPORTS = 200;
const reports = new Map();

function removeExpiredReports() {
  const now = Date.now();

  for (const [id, report] of reports) {
    if (report.expiresAt <= now) {
      reports.delete(id);
    }
  }
}

function pagePayload(id, report, page) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_PREFIX + id + ':' + (page - 1))
      .setLabel('← Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 1),

    new ButtonBuilder()
      .setCustomId(BUTTON_PREFIX + id + ':' + (page + 1))
      .setLabel('Next →')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === report.pages.length),
  );

  return {
    content: null,
    embeds: [report.pages[page - 1]],
    components: [row],
    allowedMentions: { parse: [] },
  };
}

async function privateNotice(interaction, content) {
  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

module.exports = {
  buttonPrefix: BUTTON_PREFIX,

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
        .setDescription('Page number: ' + PAGE_SIZE + ' members per page.')
        .setMinValue(1)
    )

    .addStringOption(option =>
      option
        .setName('scope')
        .setDescription(
          'Choose raids in this guild or across all guilds.'
        )
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
    // Acknowledge before fetching data so the command does not time out.
    await interaction.deferReply();

    const snapshot = await api.getGuild();

    const days = interaction.options.getInteger('days');
    const page = interaction.options.getInteger('page') ?? 1;
    const scope = interaction.options.getString('scope') ?? 'current';

    // Without days, display the existing cumulative leaderboard.
    const period = days === null
      ? null
      : history.compare(snapshot, days, scope);

    const display = period?.snapshot ?? snapshot;

    const pageCount = Math.max(
      1,
      Math.ceil(display.members.length / PAGE_SIZE)
    );

    if (
      !Number.isInteger(page)
      || page < 1
      || page > pageCount
    ) {
      throw new RangeError(
        'Choose a page from 1 to ' + pageCount + '.'
      );
    }

    // Prepare every page from the same data.
    // Button clicks therefore make no additional Wynncraft requests
    // and cannot accidentally switch a day report to cumulative totals.
    const pages = Array.from(
      { length: pageCount },
      (_, index) => {
        const embed = buildLeaderboard(display, {
          page: index + 1,
          scope,
        });

        if (period) {
          embed
            .setTitle(
              embed.data.title + ' | Last ' + days + ' day(s)'
            )
            .addFields(
              {
                name: 'Measured interval',
                value:
                  stamp(period.start) + ' → ' + stamp(period.end),
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

        embed.setFooter({
          text: embed.data.footer.text + ' · Buttons: 15 min',
        });

        return embed;
      }
    );

    removeExpiredReports();

    // Bound memory usage when many reports are requested.
    // Removing a temporary report does not delete saved raid history.
    while (reports.size >= MAX_REPORTS) {
      reports.delete(reports.keys().next().value);
    }

    const id = randomBytes(12).toString('hex');

    const report = {
      pages,
      page,
      ownerId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      messageId: null,
      expiresAt: Date.now() + BUTTON_LIFETIME,
      queue: Promise.resolve(),
    };

    reports.set(id, report);

    try {
      const message = await interaction.editReply(
        pagePayload(id, report, page)
      );

      // Bind the buttons to this specific Discord message.
      report.messageId = message.id;
    } catch (error) {
      reports.delete(id);
      throw error;
    }
  },

  async executeButton(interaction) {
    removeExpiredReports();

    const match =
      /^guildraids:([a-f0-9]{24}):(\d{1,6})$/.exec(
        interaction.customId
      );

    const report = match ? reports.get(match[1]) : null;

    if (!report) {
      await privateNotice(
        interaction,
        'These page buttons have expired. '
        + 'Run /guildraids again with your days/scope options.'
      );
      return;
    }

    // Each person can navigate the report they requested.
    if (interaction.user.id !== report.ownerId) {
      await privateNotice(
        interaction,
        'These buttons belong to the person who requested this report. '
        + 'Run /guildraids to open your own.'
      );
      return;
    }

    // Do not allow a button to control a different message.
    if (
      interaction.guildId !== report.guildId
      || interaction.channelId !== report.channelId
      || interaction.message.id !== report.messageId
    ) {
      await privateNotice(
        interaction,
        'This button does not match its report. '
        + 'Run /guildraids again.'
      );
      return;
    }

    const page = Number(match[2]);

    if (page < 1 || page > report.pages.length) {
      await privateNotice(
        interaction,
        'That page is unavailable.'
      );
      return;
    }

    // Acknowledge immediately, even if another click is still being handled.
    // Capture failures so they do not become unhandled promise rejections.
    const acknowledged = interaction.deferUpdate().then(
      () => null,
      error => error
    );

    const change = report.queue.then(async () => {
      const error = await acknowledged;
      if (error) throw error;

      // Repeated clicks targeting the same page need no extra edit.
      if (report.page === page) return;

      await interaction.editReply(
        pagePayload(match[1], report, page)
      );

      report.page = page;
    });

    // Process message edits in order. A failed edit must not prevent
    // a later button click from succeeding.
    report.queue = change.catch(() => {});

    await change;
  },
};