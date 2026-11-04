'use strict';
const path = require('node:path');
const os = require('node:os');

/** Use the same home for connection discovery, profiles and summary caches. */
function resolveDshHome({ env = process.env, homedir = os.homedir() } = {}) {
  const configured = env && typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
  return path.normalize(configured || path.join(homedir, '.dsh'));
}
module.exports = { resolveDshHome };
