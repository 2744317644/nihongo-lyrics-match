// dsh-nihongo-lyrics-match — Host half.
//
// Registers the three lyrics tools against the installed tool registry and,
// when the Web carrier is mounted, the same-origin JSON endpoints the
// Settings panel uses. Every registration is effect-owned by this plugin's
// context, so unloading or disabling the bundle removes the tools and the
// routes. Engines are shared: both callers run `reviewDirectory()` /
// `revertPath()` rather than keeping a second copy of the logic.

import { toolDefinitions } from './lib/tools.js';
import { installReviewApi } from './lib/web-api.js';

export const name = 'nihongo-lyrics-match';

export const inject = ['tools'];

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  for (const definition of toolDefinitions) {
    ctx.tools.register(definition);
  }

  // Optional: headless profiles have no web carrier and only get the tools.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => installReviewApi(webCtx.webServer), 'lyrics-review: panel routes');
  });
}
