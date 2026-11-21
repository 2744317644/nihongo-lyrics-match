// dsh-nihongo-lyrics-match — Host half.
//
// Registers the four lyrics tools against the installed tool registry. The
// settings panel has been removed; the interactive HTML report and the tools
// are the only user-facing surfaces. Every registration is effect-owned by
// this plugin's context, so unloading or disabling the bundle removes the
// tools.

import { toolDefinitions } from './lib/tools.js';

export const name = 'nihongo-lyrics-match';

export const inject = ['tools'];

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  for (const definition of toolDefinitions) {
    ctx.tools.register(definition);
  }
}
