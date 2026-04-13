/**
 * Unwrap an ESM module's default export.
 * Returns `module.default` when a default export exists, otherwise the module itself.
 * Returns `undefined` for falsy inputs.
 * @param {*} module
 * @returns {*}
 */
export function unwrapDefault(module) {
  if (!module) return undefined;
  if (typeof module === 'object' && 'default' in module) {
    return module.default;
  }
  return module;
}
