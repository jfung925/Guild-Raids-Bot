**Wynncraft Guild Raid Bot**

Start with **CLOUD_SETUP.md** for the complete cloud setup. This edition uses JavaScript and Node.js, with a command/helper/interval organization inspired by the oxids bot example. SETUP.md explains the files and optional local testing. REFERENCE.md records the sources reviewed.

| Item | Value |
| --- | --- |
| Hosting runtime | Node.js 24.17.0 or newer; tested with 24.19.0 |
| Hosting Entry File / STARTUP_FILE | `index.js` |
| Normal run mode | `RUN_MODE=bot` |
| Packages | `discord.js` 14.27.0 and `dotenv` 18.0.1 |
| Dependency files | `package.json` and `package-lock.json` |
| Saved state | `data/leaderboard.json` by default |
| Main command | `/guildraids` |
| Other commands | `/ping` and `/help` |

The bot discovers the guild roster automatically. It shows each current member's cumulative raids in this guild, or their guild raids across all guilds. It can edit one shared first-page leaderboard approximately every five minutes. Ordinary slash-command replies remain snapshots. Private or missing values show as Unavailable.

**What to configure**

Supply your Discord bot token, Discord server ID, and full Wynncraft guild name. Begin with leaderboard channel ID `0`; enable automatic updates after command testing. Use the hosting environment manager, `.env`, or `config.json`. Configuration priority and every setting are documented in SETUP.md.

**Download contents**

The ZIP has no enclosing project folder: `index.js` and `package.json` are at its root for direct upload. It contains source code, comments, tests, a dependency lockfile, configuration examples, and guides. Dependencies are installed by the host.

**Scope**

This starter serves one Discord server and one Wynncraft guild. Run one process for it. It reports cumulative counters and does not calculate weekly totals or store raid history. The saved JSON contains the shared message's identity only.

