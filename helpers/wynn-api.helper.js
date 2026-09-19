'use strict';

/**
 * Public Wynncraft API access and guild response parsing.
 * One guild response contains the roster and members' guild raid counters.
 * https://docs.wynncraft.com/modules/guild/get-guild-by-name
 */
const { performance } = require('node:perf_hooks');

class WynnError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WynnError';
  }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function raidCount(data, field) {
  const total = isObject(data?.[field]) ? data[field].total : undefined;
  // Missing, private, negative, fractional, and unsafe values remain unknown.
  // Zero is valid; null must never be silently converted to zero.
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

function parseGuild(payload, retrievedAt = new Date()) {
  if (!isObject(payload) || !isObject(payload.members)
      || typeof payload.name !== 'string' || !payload.name.trim()) {
    throw new WynnError('Wynncraft returned an unexpected guild response.');
  }
  const membersByUuid = new Map();
  for (const [rank, group] of Object.entries(payload.members)) {
    // Include every returned rank, including future rank names. total is metadata.
    if (rank === 'total') continue;
    if (!isObject(group)) throw new WynnError('Wynncraft returned an invalid member rank group.');
    for (const [identifier, entry] of Object.entries(group)) {
      if (!isObject(entry)) throw new WynnError('Wynncraft returned an invalid guild member.');
      const uuid = typeof entry.uuid === 'string' ? entry.uuid : identifier;
      const username = typeof entry.username === 'string' ? entry.username : identifier;
      const restricted = entry.restrictions?.main_access === true
        || entry.restrictions?.mainAccess === true;
      const data = !restricted && isObject(entry.globalData) ? entry.globalData : {};
        const member = Object.freeze({
        uuid,
        username,
        rank,

        // A changed join date helps detect leaving/rejoining
        // between API polls.
        joinedAt:
          typeof entry.joined === 'string'
          && Number.isFinite(Date.parse(entry.joined))
            ? new Date(entry.joined).toISOString()
            : null,

        current: raidCount(data, 'currentGuildRaids'),
        all: raidCount(data, 'guildRaids'),
      });
      // UUID stays stable across username changes and prevents duplicate rows.
      if (membersByUuid.has(uuid)) {
        const previous = membersByUuid.get(uuid);
        if (previous.current !== member.current || previous.all !== member.all) {
          membersByUuid.set(uuid, Object.freeze({ ...member, current: null, all: null }));
        }
      } else {
        membersByUuid.set(uuid, member);
      }
    }
  }
  if (payload.members.total > 0 && membersByUuid.size === 0) {
    throw new WynnError('Wynncraft returned a member count without a readable roster.');
  }
  return Object.freeze({
    name: payload.name,

    // Keep the guild's identity alongside its display name.
    guildUuid:
      typeof payload.uuid === 'string'
        ? payload.uuid
        : null,

    members: Object.freeze([...membersByUuid.values()]),
    retrievedAt: retrievedAt.toISOString(),
  });
}

function rankedMembers(snapshot, scope = 'current') {
  if (!['current', 'all'].includes(scope)) throw new RangeError('Choose current or all for scope.');
  return [...snapshot.members].sort((a, b) => {
    // Unknown counts follow all visible counts, including visible zeroes.
    if ((a[scope] === null) !== (b[scope] === null)) return a[scope] === null ? 1 : -1;
    const difference = (b[scope] ?? 0) - (a[scope] ?? 0);
    return difference || a.username.localeCompare(b.username, 'en', { sensitivity: 'base' });
  });
}

function retryMilliseconds(headers, wallNow = Date.now()) {
  const waits = [];
  for (const key of ['Retry-After', 'RateLimit-Reset']) {
    const raw = headers.get(key);
    if (raw === null || raw.trim() === '') continue;
    let milliseconds = Number(raw) * 1000;
    // Retry-After may be a date; Wynncraft's RateLimit-Reset is seconds.
    if (!Number.isFinite(milliseconds) && key === 'Retry-After') {
      milliseconds = Date.parse(raw) - wallNow;
    }
    if (Number.isFinite(milliseconds)) waits.push(milliseconds);
  }
  return Math.max(60000, ...waits);
}

function cacheMilliseconds(headers) {
  const directive = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?(?=\s*(?:,|$))/i
    .exec(headers.get('Cache-Control') ?? '');
  const seconds = directive ? Number(directive[1]) : 120;
  const milliseconds = seconds * 1000;
  // A huge numeric header can overflow while converting seconds to milliseconds.
  return Number.isFinite(milliseconds) ? Math.max(120000, milliseconds) : 120000;
}

class WynnClient {
  constructor(guildName, { fetchImpl = globalThis.fetch, clock = () => performance.now(),
    wallClock = () => Date.now(), baseUrl = 'https://api.wynncraft.com/v3' } = {}) {
    this.url = new URL(baseUrl + '/guild/' + encodeURIComponent(guildName));
    this.url.searchParams.set('identifier', 'uuid');
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.wallClock = wallClock;
    this.snapshot = null;
    this.cacheUntil = 0;
    this.nextAttempt = 0;
    this.lastError = 'Wynncraft is temporarily unavailable.';
    this.inFlight = null;
  }

  async getGuild() {
    if (this.snapshot && this.clock() < this.cacheUntil) return this.snapshot;
    // Many commands and the shared board can all reuse one pending request.
    if (this.inFlight) return this.inFlight;
    if (this.clock() < this.nextAttempt) {
      const seconds = Math.ceil((this.nextAttempt - this.clock()) / 1000);
      throw new WynnError(this.lastError + ' Try again in about ' + seconds + ' seconds.');
    }
    this.inFlight = this.fetchGuild();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  async fetchGuild() {
    try {
      const response = await this.fetchImpl(this.url, {
        headers: { Accept: 'application/json', 'User-Agent': 'WynncraftGuildRaidBot/2.0' },
        signal: AbortSignal.timeout(20000),
        redirect: 'manual',
      });
      if (response.status !== 200) {
        this.nextAttempt = this.clock() + retryMilliseconds(response.headers, this.wallClock());
        // Discard the response body instead of posting an upstream error page.
        await response.body?.cancel();
        if (response.status === 429) throw new WynnError('Wynncraft\'s request limit was reached.');
        if (response.status === 404) throw new WynnError('Guild not found. Set the exact full Wynncraft guild name.');
        if (response.status === 300) throw new WynnError('The name matched multiple guilds. Use its exact full name.');
        if ([401, 403].includes(response.status)) throw new WynnError('Wynncraft denied the public guild lookup (HTTP ' + response.status + ').');
        throw new WynnError('Wynncraft returned HTTP ' + response.status + '. Try again later.');
      }

      const snapshot = parseGuild(await response.json(), new Date(this.wallClock()));
      const ttl = cacheMilliseconds(response.headers);
      if (response.headers.get('RateLimit-Remaining') === '0') {
        this.nextAttempt = this.clock() + retryMilliseconds(response.headers, this.wallClock());
        this.lastError = 'Wynncraft\'s request limit was reached.';
      }
      // Parsing must succeed before replacing the previous data and timestamp.
      this.snapshot = snapshot;
      this.cacheUntil = this.clock() + ttl;
      return snapshot;
    } catch (error) {
      const safeError = error instanceof WynnError ? error
        : new WynnError('Could not read Wynncraft\'s API. Check the connection and try later.');
      this.lastError = safeError.message;
      this.nextAttempt = Math.max(this.nextAttempt, this.clock() + 60000);
      throw safeError;
    }
  }
}

module.exports = { WynnClient, WynnError, parseGuild, rankedMembers, retryMilliseconds, cacheMilliseconds };
