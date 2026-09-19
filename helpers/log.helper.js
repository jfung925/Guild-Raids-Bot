'use strict';

/** Small console logger suited to the hosting panel's live log viewer. */
function createLogger(token = '') {
  const clean = value => {
    let text = String(value).replace(/[\r\n]/g, ' ');
    if (token) text = text.split(token).join('[REDACTED]');
    return text.slice(0, 800);
  };
  const write = (level, message, error) => {
    // Log only the message/code, never Discord request bodies or config objects.
    const detail = error ? ' | ' + clean(error.message ?? 'Unexpected error')
      + (error.code !== undefined ? ' [code ' + clean(error.code) + ']' : '') : '';
    const line = new Date().toISOString() + ' ' + level + ' ' + clean(message) + detail;
    if (level === 'ERROR') console.error(line);
    else console.log(line);
  };
  return {
    info: message => write('INFO', message),
    warn: (message, error) => write('WARN', message, error),
    error: (message, error) => write('ERROR', message, error),
  };
}

module.exports = { createLogger };
