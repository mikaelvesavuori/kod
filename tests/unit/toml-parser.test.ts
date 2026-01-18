import { describe, test, expect } from 'vitest';

import {
  parseTOML,
  interpolate,
  processRunLine,
  evaluateCondition
} from '../../src/shared/toml-parser.js';

describe('TOML Parser', () => {
  test('It should parse a simple workflow with one step', () => {
    const toml = `
[step:test]
run: npm test
`;
    const result = parseTOML(toml);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].name).toBe('test');
    expect(result.steps[0].run).toBe('npm test');
  });

  test('It should parse top-level timeout', () => {
    const toml = `
timeout: 120

[step:build]
run: npm run build
`;
    const result = parseTOML(toml);

    expect(result.timeout).toBe(120);
    expect(result.steps).toHaveLength(1);
  });

  test('It should parse multiple steps', () => {
    const toml = `
[step:lint]
run: npm run lint

[step:test]
run: npm test

[step:build]
run: npm run build
`;
    const result = parseTOML(toml);

    expect(result.steps).toHaveLength(3);
    expect(result.steps[0].name).toBe('lint');
    expect(result.steps[1].name).toBe('test');
    expect(result.steps[2].name).toBe('build');
  });

  test('It should parse step with continue_on_error', () => {
    const toml = `
[step:test]
run: npm test
continue_on_error: true
`;
    const result = parseTOML(toml);

    expect(result.steps[0].continue_on_error).toBe(true);
  });

  test('It should parse step with if condition', () => {
    const toml = `
[step:deploy]
if: "branch == 'main'"
run: ./deploy.sh
`;
    const result = parseTOML(toml);

    expect(result.steps[0].if).toBe("branch == 'main'");
  });

  test('It should parse step with working_dir', () => {
    const toml = `
[step:build]
working_dir: ./frontend
run: npm run build
`;
    const result = parseTOML(toml);

    expect(result.steps[0].working_dir).toBe('./frontend');
  });

  test('It should parse multiline run commands', () => {
    const toml = `
[step:deploy]
run:
  echo "Starting deploy"
  ./deploy.sh
  echo "Done"
`;
    const result = parseTOML(toml);

    expect(result.steps[0].run).toContain('echo "Starting deploy"');
    expect(result.steps[0].run).toContain('./deploy.sh');
    expect(result.steps[0].run).toContain('echo "Done"');
  });

  test('It should ignore comments', () => {
    const toml = `
# This is a comment
timeout: 60

[step:test]
# Another comment
run: npm test
`;
    const result = parseTOML(toml);

    expect(result.timeout).toBe(60);
    expect(result.steps).toHaveLength(1);
  });

  test('It should parse step names with spaces', () => {
    const toml = `
[step:deploy to production]
run: ./deploy.sh prod
`;
    const result = parseTOML(toml);

    expect(result.steps[0].name).toBe('deploy to production');
  });

  test('It should parse quoted string values', () => {
    const toml = `
[step:test]
if: "branch == 'develop'"
run: npm test
`;
    const result = parseTOML(toml);

    expect(result.steps[0].if).toBe("branch == 'develop'");
  });

  test('It should parse boolean false', () => {
    const toml = `
[step:test]
run: npm test
continue_on_error: false
`;
    const result = parseTOML(toml);

    expect(result.steps[0].continue_on_error).toBe(false);
  });
});

describe('Interpolation', () => {
  test('It should interpolate {branch}', () => {
    const result = interpolate('Deploying to {branch}', {}, 'main', 'my-app');

    expect(result).toBe('Deploying to main');
  });

  test('It should interpolate {repo}', () => {
    const result = interpolate('Building {repo}', {}, 'main', 'my-app');

    expect(result).toBe('Building my-app');
  });

  test('It should interpolate {env.VAR}', () => {
    const env = { TARGET: 'production', VERSION: '1.0.0' };
    const result = interpolate(
      'Deploy to {env.TARGET} v{env.VERSION}',
      env,
      'main',
      'app'
    );

    expect(result).toBe('Deploy to production v1.0.0');
  });

  test('It should leave unknown variables unchanged', () => {
    const result = interpolate('Value is {unknown}', {}, 'main', 'app');

    expect(result).toBe('Value is {unknown}');
  });

  test('It should handle missing env variables as empty string', () => {
    const result = interpolate('Value is {env.MISSING}', {}, 'main', 'app');

    expect(result).toBe('Value is ');
  });

  test('It should interpolate multiple variables', () => {
    const env = { ENV: 'prod' };
    const result = interpolate(
      '{repo} on {branch} ({env.ENV})',
      env,
      'main',
      'my-app'
    );

    expect(result).toBe('my-app on main (prod)');
  });
});

describe('Process Run Line', () => {
  test('It should return interpolated command', () => {
    const env: Record<string, string> = {};
    const result = processRunLine('echo {branch}', env, 'main', 'app');

    expect(result).toBe('echo main');
  });

  test('It should handle env assignment with double quotes', () => {
    const env: Record<string, string> = {};
    const result = processRunLine(
      'env.TARGET = "production"',
      env,
      'main',
      'app'
    );

    expect(result).toBeNull();
    expect(env.TARGET).toBe('production');
  });

  test('It should handle env assignment with single quotes', () => {
    const env: Record<string, string> = {};
    const result = processRunLine(
      "env.API_KEY = 'secret123'",
      env,
      'main',
      'app'
    );

    expect(result).toBeNull();
    expect(env.API_KEY).toBe('secret123');
  });

  test('It should handle env assignment without quotes', () => {
    const env: Record<string, string> = {};
    const result = processRunLine('env.PORT = 3000', env, 'main', 'app');

    expect(result).toBeNull();
    expect(env.PORT).toBe('3000');
  });

  test('It should interpolate env variables set earlier', () => {
    const env: Record<string, string> = { TARGET: 'staging' };
    const result = processRunLine(
      './deploy.sh {env.TARGET}',
      env,
      'main',
      'app'
    );

    expect(result).toBe('./deploy.sh staging');
  });
});

describe('Evaluate Condition', () => {
  test('It should evaluate branch == value as true', () => {
    const result = evaluateCondition("branch == 'main'", {}, 'main', 'app');

    expect(result).toBe(true);
  });

  test('It should evaluate branch == value as false', () => {
    const result = evaluateCondition("branch == 'main'", {}, 'develop', 'app');

    expect(result).toBe(false);
  });

  test('It should evaluate branch != value as true', () => {
    const result = evaluateCondition("branch != 'main'", {}, 'develop', 'app');

    expect(result).toBe(true);
  });

  test('It should evaluate branch != value as false', () => {
    const result = evaluateCondition("branch != 'main'", {}, 'main', 'app');

    expect(result).toBe(false);
  });

  test('It should evaluate env.VAR == value as true', () => {
    const result = evaluateCondition(
      "env.NODE_ENV == 'production'",
      { NODE_ENV: 'production' },
      'main',
      'app'
    );

    expect(result).toBe(true);
  });

  test('It should evaluate env.VAR == value as false', () => {
    const result = evaluateCondition(
      "env.NODE_ENV == 'production'",
      { NODE_ENV: 'development' },
      'main',
      'app'
    );

    expect(result).toBe(false);
  });

  test('It should handle double quotes in condition', () => {
    const result = evaluateCondition('branch == "main"', {}, 'main', 'app');

    expect(result).toBe(true);
  });

  test('It should default to true for unknown condition format', () => {
    const result = evaluateCondition('some weird condition', {}, 'main', 'app');

    expect(result).toBe(true);
  });
});
