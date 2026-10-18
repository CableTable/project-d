// Two rules, on purpose (as in Project R): a name that isn't defined, and
// assigning to an import. Style is not checked.
import globals from 'globals';

export default [
  { ignores: ['web/vendor/**'] },
  {
    files: ['web/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser, __TAURI__: 'readonly' } },
    rules: { 'no-undef': 'error', 'no-import-assign': 'error' }
  }
];
