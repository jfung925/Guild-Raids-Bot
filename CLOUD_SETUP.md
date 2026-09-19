**Host your Wynncraft raid bot on Bot-Hosting.net**

This guide is for the JavaScript edition included in the latest `wynncraft-raid-bot.zip`. Your cloud deployment runs the bot, so your laptop can be switched off after setup. You configure the Wynncraft guild once; member names are discovered automatically.

The steps use the current Bot-Hosting.net panel, checked September 19, 2026. The provider maintains separate legacy and new panels. Use its current [new-panel guide](https://bot-hosting.net/docs/guides/the-new-panel) if your screen differs.

1. **Gather your details.**

   You need a Bot-Hosting.net account, permission to install a Discord application in your server, and your guild's full in-game name. Keep the ZIP and this guide available. The cloud workflow can be completed in a browser.

   The bot uses Node.js 24.17.0 or newer. Python is no longer the runtime for this edition. Node.js runs JavaScript; `index.js` is the program's entry file. The version requirement follows the selected [discord.js documentation](https://discord.js.org/docs/packages/discord.js/14.27.0).

2. **Create or reuse your Discord application.**

   Open the [Discord Developer Portal](https://discord.com/developers/applications). Create an application such as `Guild Raid Tracker`, or reuse the application from the earlier starter. Open **Bot**, obtain its bot token, and keep it private. The token is a password; it is different from the application ID and public key.

   On **Installation**, enable **Guild Install**. Select `bot` and `applications.commands` as the installation scopes. Grant **View Channels**, **Send Messages**, **Embed Links**, and **Read Message History**. Follow the install link and add the bot to your Discord server. Channel permission overrides also apply. [Discord application setup](https://docs.discord.com/developers/quick-start/getting-started)

   This program requests only the ordinary Guilds intent. Leave privileged intents off. Leave the Interactions Endpoint URL blank: this implementation receives slash commands through its Discord connection. The bot stays offline until the cloud process starts.

3. **Copy the Discord IDs.**

   In Discord, enable **User Settings > Advanced > Developer Mode**. Right-click the server and copy its Server ID. Choose a regular text channel for the eventual board and copy its Channel ID. [Discord ID instructions](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID)

   Keep the two values separate. The Discord server ID identifies your Discord community. Your full Wynncraft guild name identifies the in-game roster to retrieve.

4. **Choose your hosting plan.**

   At the time of review, the Free plan lists 256 MB RAM and 512 MB storage, with manual renewal every four days. Starter lists 1 GB RAM for $1.99 per month excluding tax. Check the current [pricing page](https://bot-hosting.net/pricing) before selecting a plan.

   You can try the free allocation and inspect actual memory use. If dependency installation or the running process exceeds its allocation, use more memory. This package has no image-rendering or database dependencies. Free hosting requires regular account attention even though your laptop can stay off.

5. **Create the cloud deployment and upload the ZIP.**

   Sign in to [Bot-Hosting.net](https://bot-hosting.net/). Select your project, choose **New Deployment**, name it, select **Application**, and choose **ZIP** as the source. Upload the latest `wynncraft-raid-bot.zip`. Select a **Node.js** runtime meeting the version requirement and choose the resource allocation. [Create a deployment](https://bot-hosting.net/docs/guides/create-a-server)

   The provided archive contains `index.js` at its root. After extraction, check that `index.js`, `package.json`, and `package-lock.json` appear at the deployment root, alongside `commands`, `events`, `helpers`, and `intervals`. If your upload method adds a containing folder, move its contents to the root.

   You can instead create a Blank application and upload through Files. Keep the initial process stopped while filling in configuration.

6. **Set the startup file and environment values.**

   Under **Startup**, set **Entry File (STARTUP_FILE)** to exactly `index.js`. The Node.js runtime installs dependencies from `package.json` during startup. Keep the supplied lockfile too. The panel console is not a shell and does not accept `npm install` commands. [Host startup and package instructions](https://bot-hosting.net/docs/guides/set-up-a-server)

   Open the deployment's environment-variable manager and add:

   | Name | Value to enter |
   | --- | --- |
   | `DISCORD_TOKEN` | Your real Discord bot token |
   | `DISCORD_SERVER_ID` | Your copied Discord server ID |
   | `WYNN_GUILD_NAME` | Your full Wynncraft guild name, including spaces |
   | `LEADERBOARD_CHANNEL_ID` | `0` for the first test |
   | `REFRESH_SECONDS` | `300` |
   | `DATA_DIR` | `data` |
   | `RUN_MODE` | `check-api` for the first diagnostic |

   In separate name/value form fields, enter raw values without surrounding quotes. Save the settings. Use the full in-game guild name, not its short tag or a player's username. The code handles spaces and URL encoding.

   If you prefer file configuration, duplicate `config.example.json` as `config.json` using the file manager. Fill in the matching keys documented in SETUP.md. Keep Discord IDs in double quotes. Set `mode` to `check-api` for the first diagnostic. Choose one configuration method initially to avoid conflicting values; environment variables take priority over files.

   Keep your real token out of GitHub, chat messages, and screenshots. If it is exposed, reset it in Discord and update the host.

7. **Run the Wynncraft diagnostic.**

   With `RUN_MODE=check-api`, start the deployment and read its logs. A successful check prints the guild name, member count, visible and unavailable current-guild counts, and up to five entries. It ends with `API check complete. No connection to Discord was made.`

   The diagnostic then exits deliberately. A stopped process after that success message is expected. Stop any repeated restart attempts before changing settings. If it reports Guild not found, correct the full name. If it reports 403, 429, a timeout, or another API error, see the troubleshooting table below.

   This reads public guild data and needs no Wynncraft API token. A member's access rules may hide a count. The starter respects those restrictions. [Wynncraft privacy documentation](https://docs.wynncraft.com/privacy)

8. **Connect the bot to Discord.**

   Set `RUN_MODE=bot`, save, and start the deployment. If using `config.json`, set its `mode` to `bot` instead. Stop any earlier local or cloud copy using the same bot account before this step.

   Successful logs include `Registered 3 command(s) in server ...` and `Connected as ...`. Registration happens automatically in the configured server, so you do not need to run a separate registration script. No application/client ID is required in this starter's settings.

   If you want a configuration-only diagnostic, use `RUN_MODE=check-config`. It checks formatting and required values without contacting either service; it cannot prove that a token or ID belongs to your account. Return to `bot` afterward.

9. **Test the commands.**

   In a channel the bot can access, run `/ping`, followed by `/guildraids`.

   | Command | Result |
   | --- | --- |
   | `/ping` | Private confirmation that the bot responds |
   | `/help` | Private explanation of the available commands |
   | `/guildraids` | Public first page, ranked by cumulative raids in this guild |
   | `/guildraids page:2` | Next 25 members when the roster has another page |
   | `/guildraids scope:all` | Current members ranked by guild raids across all guilds |

   Select the options in Discord's slash-command interface. The leaderboard includes coverage and the successful API retrieval time. A slash-command reply is a snapshot; run the command again to obtain a later result.

   The implementation uses `currentGuildRaids.total` for the default view and `guildRaids.total` for the all-guild view. They are distinct from ordinary raid statistics. [Wynncraft's counter definitions](https://docs.wynncraft.com/2026-05-14-v3-7-2)

10. **Enable the shared automatic leaderboard.**

    Stop the deployment. Change `LEADERBOARD_CHANNEL_ID` from `0` to the chosen channel ID, save, and start again. Leave `REFRESH_SECONDS=300` for a refresh approximately every five minutes. Each interval starts after the previous update finishes.

    The bot creates one first-page board and edits that message on later successful refreshes. For the remaining members, use `/guildraids page:2` and later pages. The roster is obtained again on each successful API refresh.

    The bot writes `data/leaderboard.json`, containing the server, channel, and message IDs. Keep this file across restarts and code updates. The in-memory API cache lasts at least two minutes, so a newly completed raid may not appear immediately. [Guild endpoint and cache behavior](https://docs.wynncraft.com/modules/guild/get-guild-by-name)

    Stop and start the deployment once. Verify that the same board message is edited. This checks state retention in your actual hosting environment. If you intentionally delete the Discord board, the bot creates a replacement on a later successful update.

11. **Verify operation with your laptop off.**

    After the bot is running in the panel, close the hosting browser tab and switch off your laptop. From your phone or another device, run `/ping` and `/guildraids`. If you enabled the board, check its timestamp after the next update interval.

    Your cloud process now performs the work. Keep one instance running. A failed API refresh leaves the last successful board timestamp intact and writes a log entry, allowing you to distinguish old data from a fresh result.

12. **Keep the free plan active and back up your state.**

    For the free plan, use **Billing > Renew free plan**, complete the site's check, then choose **Renew for 4 days** before expiry. The provider documents four active days and a three-day grace period, followed by deletion; its temporary post-deletion backup lasts one day. Keep your own copy of the source and `data` folder. [Free-plan renewal](https://bot-hosting.net/docs/guides/renew-free-subscription)

    Treat downloaded configuration files as private because they may contain the bot token. The deployment's normal filesystem is where this bot stores its message ID; no SQL database is required by this implementation.

13. **Update the code or use GitHub later.**

    Stop the bot, back up its state, upload the changed source files, preserve your real `.env` or `config.json` and `data/`, then restart. Keep `package.json` and its lockfile together when changing dependency versions. Do not upload a local `node_modules` folder.

    To use GitHub, create your own repository containing this package's source and templates. Keep real configuration and state out of it. Select that repository in the host's GitHub import flow. Private repositories require a connected GitHub account with access.

    For an existing deployment, choose the host's **Merge** sync strategy to retain files absent from the repository. **Replace all files** removes existing files, including saved state unless you restore it afterward. [GitHub synchronization](https://bot-hosting.net/docs/guides/clone-a-github-repository)

    The oxids repository was the design reference. Import this prepared package or your repository containing it to run the raid bot described here.

14. **Migrate the earlier Python starter, if you already used it.**

    Stop the earlier instance and download its `.env` and `data/leaderboard.json`. Deploy the JavaScript package with Node.js and `index.js`, then transfer those private files to the corresponding locations. Its original five environment setting names are supported.

    The state reader accepts the earlier Python JSON format and preserves its large numeric IDs without rounding. After a successful refresh, it saves the newer string-ID format. Reuse the same Discord bot account, server, and channel to continue editing the existing board. If you use another bot account, remove the previous board and start with new state.

**Troubleshooting**

| Symptom | Check or action |
| --- | --- |
| Cannot find `index.js` | Confirm it is at the deployment root and Entry File is `index.js`. |
| Unsupported Node version | Select Node.js 24.17.0 or newer; check the startup log for the actual version. |
| Cannot find module `discord.js` or `dotenv` | Check that package.json was uploaded and inspect earlier dependency-installation errors. |
| Invalid configuration | Correct the named setting. In JSON, IDs must be quoted strings. Check host variables for overrides. |
| Guild not found | Use the full in-game guild name and restart. |
| Wynncraft HTTP 403 | The public lookup was denied. Check the API's availability from the host and contact the provider if needed. |
| Wynncraft HTTP 429 | Allow the documented reset time. The running bot automatically backs off. |
| API timeout or HTTP 5xx | Inspect the service status and retry later. The current board retains its last successful timestamp. |
| Unavailable count | The value is missing, restricted, or invalid. It is not a recorded zero. |
| Login failed | Use the bot token from the Bot page, not an application ID or client secret. |
| Slash commands missing | Check registration logs, server ID, installation scopes, and permission to use application commands. Reopen Discord if needed. |
| Missing Access / Missing Permissions | Check installation and channel overrides for View Channels, Send Messages, Embed Links, and Read Message History. |
| Automatic board missing | Confirm channel ID, server ID, regular text-channel type, `RUN_MODE=bot`, and a restart after configuration. |
| Board duplicated after an update | Stop extra processes and restore the saved state if it was replaced or removed. |
| Process stops with memory errors | Inspect resource graphs and dependency-installation logs; allocate more memory. |
| Diagnostic finishes and stops | Expected for `check-api` and `check-config`; change the mode to `bot` for continuous operation. |

**Recover damaged state**

Stop the bot. Download `data/leaderboard.json` as a backup. To resume the same message, restore a valid backup. Alternatively, delete the old board message in Discord, rename the damaged file, and restart to create a new board. The bot deliberately refuses to overwrite damaged state automatically.

**What was verified**

The project passed 21 automated checks on Node.js 24.19.0 with its pinned dependencies. Tests include a local HTTP server and simulated Discord interactions, including restart recovery and error handling. The live player URL could not be retrieved from this preparation environment. No Discord token was supplied, and no real hosted deployment or Discord messages were created here. Steps 7–11 verify those live connections in your account.

**What the counts mean**

These are cumulative API counters for current roster members. Weekly tracking would require stored historical snapshots, a chosen reset time and timezone, and rules for joining, leaving, hidden counts, and decreases. This package stores only the shared message's identity; it does not reconstruct weekly activity.
