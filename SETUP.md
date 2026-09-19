**Wynncraft raid bot — code guide and optional local setup**

For cloud hosting, follow **CLOUD_SETUP.md** first. This JavaScript edition replaces the earlier Python runtime and follows the command/helper/interval organization of the linked oxids example. Your laptop is needed only if you choose to edit or test locally.

**Understand the project**

| File or folder | Responsibility |
| --- | --- |
| `index.js` | Validates settings, connects, registers commands, starts the board, and handles shutdown |
| `commands/guilds/guildraids.js` | Defines `/guildraids` and its page/scope options |
| `commands/bot/` | Defines `/ping` and `/help` |
| `events/interaction-create.js` | Routes commands and returns expected errors to Discord |
| `helpers/config.helper.js` | Reads settings and validates IDs, intervals, and modes |
| `helpers/wynn-api.helper.js` | Fetches the roster, parses counts, caches data, and backs off after failures |
| `helpers/leaderboard.helper.js` | Sorts and formats paginated Discord embeds |
| `helpers/state.helper.js` | Reads and atomically replaces the saved message-ID file |
| `helpers/command.helper.js` | Loads command modules and registers them for the configured server |
| `helpers/log.helper.js` | Writes concise logs and redacts the configured token |
| `intervals/leaderboard.js` | Creates or edits the shared board and schedules the next update |
| `test/bot.test.js` | Tests API, state, configuration, formatting, and Discord response behavior |
| `package.json` | Startup scripts and exact direct dependency versions |
| `package-lock.json` | Exact dependency tree used for reproducible local installation |
| `.env.example` / `config.example.json` | Alternative configuration templates |
| `REFERENCE.md` | Reference repository and official documentation reviewed |

**Configuration reference**

Settings are read from the hosting environment first, then `.env`, then `config.json`, then defaults. A command-line diagnostic option overrides RUN_MODE. The program reads files relative to `index.js`, independent of the current terminal directory. Restart after changing settings.

| Environment name | config.json key | Meaning/default |
| --- | --- | --- |
| `DISCORD_TOKEN` | `token` | Secret Discord bot token; required for bot and config-check modes |
| `DISCORD_SERVER_ID` | `discordServerId` | Discord server ID as text; required for bot/config-check modes |
| `WYNN_GUILD_NAME` | `guildName` | Full in-game guild name; required in every mode |
| `LEADERBOARD_CHANNEL_ID` | `leaderboardChannelId` | Text-channel ID; default `0` disables automatic posts |
| `REFRESH_SECONDS` | `refreshSeconds` | Default `300`; allowed 120–86400 seconds |
| `DATA_DIR` | `dataDirectory` | Default `data`, relative to index.js; also accepts an absolute path |
| `RUN_MODE` | `mode` | Default `bot`; also `check-api` or `check-config` |

In `config.json`, token, IDs, names, folder, and mode are double-quoted strings. `refreshSeconds` may be a JSON number. JSON does not allow comments, so explanations belong in this guide and the commented `.env.example`. A `.env` guild name containing spaces may be surrounded by quotes. Individual host variable form fields use unquoted values.

`check-config` validates formatting; it does not authenticate the token. `check-api` needs only the guild name and makes no Discord connection. `bot` runs continuously until stopped.

**Optional local setup**

1. Install Node.js 24.17.0 or newer from [Node.js downloads](https://nodejs.org/en/download). Open a terminal in a folder containing the extracted `index.js` and `package.json`.

2. Check the runtime and install the pinned dependencies:

   ```bash
   node --version
   npm ci
   ```

   These are local terminal commands. Bot-Hosting.net's console does not provide a shell; use its package files and Startup settings instead.

3. Create your private configuration. On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

   On macOS/Linux:

   ```bash
   cp .env.example .env
   ```

   Copy only during initial setup; replacing an existing .env would erase your settings. Fill in the full guild name first. You can instead duplicate `config.example.json` as `config.json`, keeping IDs in quotes.

4. Run the local checks and the public API diagnostic:

   ```bash
   npm test
   npm run check:api
   ```

   The tests use synthetic fixtures and local stand-ins. The API diagnostic contacts Wynncraft for your configured guild and prints its result without logging in to Discord.

5. Complete the Discord application, installation, and ID steps in CLOUD_SETUP.md. Set the token and server ID, retain channel ID `0`, then run:

   ```bash
   npm run check:config
   npm start
   ```

   Run `/ping` and `/guildraids` in Discord. Stop with Ctrl+C. To enable a shared board, set the channel ID and restart. Keep one instance running; stop the local process before starting the cloud copy.

**How the data travels through the code**

A slash command reaches the interaction event, which selects the command module. `/guildraids` acknowledges the request before waiting on Wynncraft. The API helper returns either a cached snapshot or one newly fetched guild response. The leaderboard helper sorts its members and builds the requested page. Discord receives the resulting embed.

The automatic task uses the same API helper, so commands and the task share both cached data and a pending request. A timer is scheduled after each update completes. This prevents overlapping background updates when an API request takes longer than usual.

Each successful refresh uses the current roster. UUIDs identify members. Missing/private counts remain `null` internally and become Unavailable on screen; zero remains zero. Identical duplicate UUID records become one row. Conflicting duplicate counters become unavailable instead of choosing an arbitrary count.

`currentGuildRaids.total` means the member's guild raids in this guild. `guildRaids.total` means guild raids across all guilds. The bot does not add normal raid totals or treat the sum of member participation counts as a number of distinct guild events. [Wynncraft counter definitions](https://docs.wynncraft.com/2026-05-14-v3-7-2)

**State, errors, and updates**

The saved JSON records the automatic board's server, channel, and message IDs as strings. IDs are too large to safely handle as ordinary JavaScript numbers. The reader also supports the preceding Python starter's numeric-ID format using Node's original JSON source text.

State writes use a temporary file and a rename within the same directory. Damaged state stops automatic startup rather than being silently reset. Back up the data folder before deployment updates. A process crash between creating a Discord message and saving its ID can still leave an orphaned board; remove any duplicate and retain the state for the message you want to use.

A deleted message is replaced only when Discord specifically reports Unknown Message. Permission and network errors preserve the existing ID. After a transient save failure, the live process retains the new ID and retries saving it on the next successful refresh.

API failures do not update the saved snapshot or the board's successful retrieval time. Requests back off for at least a minute, honoring longer reset headers. Successful results are cached for at least two minutes. The bot does not bypass API privacy or rate limits. [Wynncraft request behavior](https://docs.wynncraft.com/welcome)

**Validation and scope**

Twenty-one automated checks passed using Node.js 24.19.0, discord.js 14.27.0, and dotenv 18.0.1. The test suite includes actual local HTTP requests, simulated Discord behavior, and temporary-file state recovery. It does not prove live permissions, account limits, or cloud deployment availability. Follow CLOUD_SETUP.md to verify those in your environment.

The bot supports one Discord server and one Wynncraft guild per process. It reports cumulative totals. Historical or weekly raid counts require an additional history store and period rules; they are not implemented here.
