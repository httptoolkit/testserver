export default {
  trace: true,
  files: [
    'package.json',
    'tsconfig.json',
    'src/**/*.ts',
    'test/**/*.ts',
    '!test/**/*.spec.ts'
  ],
  tests: [
    'test/**/*.spec.ts'
  ],

  workers: {
    restart: true
  },

  testFramework: 'mocha',
  env: {
    type: 'node'
  }
};