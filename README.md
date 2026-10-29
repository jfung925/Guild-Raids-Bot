# Wynncraft Guild Raids Bot

A Node.js Discord bot for Wynncraft guild raid reports, player profiles, mount feeding calculators, a mythic identification simulator, Wordle, aspect allocations and Annihilation party signups.

## Commands

| Command | Purpose |
| --- | --- |
| `/guildraids` | Guild raid totals, saved-history period reports, player lookup and pagination |
| `/aspects` | Raid-based aspect allocation with an editable exclusion file |
| `/annihilation` | Public signup pool, party management, manual party creation and role-balanced randomization |
| `/profile` | Wynncraft player statistics |
| `/wyvern`, `/horse`, `/adasaur` | Mount feeding calculators |
| `/wyvernmax`, `/horsemax`, `/adasaurmax` | Feeding calculations with eligible higher-level materials |
| `/gamble` | Mythic identification simulation, saved rolls and usage counters |
| `/wordle` | Public English-word puzzles with requester-only guessing controls |
| `/ping`, `/help` | Bot response and command information |

## Runtime and hosting

- Node.js **24.17.0 or newer**, as required by package.json.
- Bot-Hosting startup/entry file: **index.js**.
- Install dependencies with `npm ci`; start with `npm start`.
- Use `npm run check:config` for configuration validation.
- One process can register commands in multiple configured Discord servers while tracking the configured Wynncraft guild.
- `leaderboardChannelId: "0"` disables automatic leaderboard posting. Background raid tracking continues at the configured refresh interval.

## First-time configuration

Copy these templates to their local names and then edit the local files:

| Repository template | Local file |
| --- | --- |
| config.example.json | config.json |
| annihilation-organizers.example.json | annihilation-organizers.json |
| aspects-exclusions.example.json | aspects-exclusions.json |

Put the Discord bot token in local config.json, a local .env file, or the host's environment settings. Keep Discord IDs as quoted strings. The supplied JSON template is set up for the testing and Pavilion servers; change those IDs for a different installation.

The organizer template authorizes nobody until actual Discord user IDs or role IDs are added. Fill in the desired aspects exclusion list in the local exclusions file. The optional .env.example documents environment settings; use one configuration method consistently to avoid stale environment values overriding JSON.

The older CLOUD_SETUP.md and SETUP.md are retained for reference. They describe earlier versions; use the current templates and this README for the current configuration and feature list.

## Data and assets

Keep the host's existing data folder when updating. It contains raid history, saved gamble rolls and counters, Wordle state, ping totals and Annihilation signups. These SQLite databases and backups are intentionally excluded from Git.

The data files committed here are only the named font files, their license texts and the replaceable public item-catalog cache used by the simulator. The bot's JavaScript, dependency versions and supplied tests are unchanged from the uploaded host export.
