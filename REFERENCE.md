**Implementation references — reviewed September 19, 2026**

**Requested example**

[oxids/oxids-bot](https://github.com/oxids/oxids-bot), reviewed at commit [aaed254b70ecf74dd80a489a4161bb2c984c83b7](https://github.com/oxids/oxids-bot/commit/aaed254b70ecf74dd80a489a4161bb2c984c83b7).

The reviewed files included `index.js`, `package.json`, `config.example.json`, `update-commands.js`, `commands/guilds/guild-xp-leaderboard.js`, `helpers/wynn-api.helper.js`, `helpers/file.helper.js`, and `intervals/xp-tracker.js`.

This starter is an independent implementation inspired by that project's CommonJS entry file, per-command `data`/`execute` modules, API helpers, interval folder, and restartable leaderboard concept. It implements guild raid counters for the user's requested use case. Command registration runs during startup because the target host's current console does not provide shell access. All code in this package was written for this starter; the reference project itself is not bundled.

**Official hosting documentation**

- [Current panel](https://bot-hosting.net/docs/guides/the-new-panel)
- [Create a deployment](https://bot-hosting.net/docs/guides/create-a-server)
- [Entry file, uploads, and dependency installation](https://bot-hosting.net/docs/guides/set-up-a-server)
- [Free-plan renewal](https://bot-hosting.net/docs/guides/renew-free-subscription)
- [Pricing](https://bot-hosting.net/pricing)
- [GitHub import and sync strategies](https://bot-hosting.net/docs/guides/clone-a-github-repository)

**API and library documentation**

- [Wynncraft guild-by-name response](https://docs.wynncraft.com/modules/guild/get-guild-by-name)
- [Wynncraft guild raid counter update](https://docs.wynncraft.com/2026-05-14-v3-7-2)
- [Wynncraft caching and rate-limit headers](https://docs.wynncraft.com/welcome)
- [Wynncraft privacy rules](https://docs.wynncraft.com/privacy)
- [discord.js](https://discord.js.org/docs/packages/discord.js/14.27.0)
- [Discord application setup](https://docs.discord.com/developers/quick-start/getting-started)
- [Discord server and channel IDs](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID)

Pinned dependency versions were confirmed against the npm registry and installed locally. The source review and automated tests are distinct from a live deployment; the user's cloud account and bot token were not available for that final integration check.
