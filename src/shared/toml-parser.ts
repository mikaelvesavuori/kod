import type { Workflow, Step } from './types.js';

/**
 * Minimal TOML parser for Kod workflow files.
 * Only supports the subset needed for workflows:
 * - Top-level key-values: `timeout: 120`
 * - Sections: `[step:name]`
 * - Multiline strings: `run:` followed by indented lines
 * - Comments: `#`
 */
export function parseTOML(content: string): Workflow {
  const lines = content.split('\n');
  const workflow: Workflow = { steps: [] };
  let currentStep: Partial<Step> | null = null;
  let inMultiline = false;
  let multilineKey = '';
  let multilineContent: string[] = [];
  let multilineIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments (but not in multiline mode)
    if (!inMultiline && (!trimmed || trimmed.startsWith('#'))) {
      continue;
    }

    // Handle multiline continuation
    if (inMultiline) {
      // Check if this line is still part of the multiline block
      const lineIndent = line.search(/\S/);

      // End multiline if we hit a non-indented line or section header
      if (
        lineIndent <= multilineIndent &&
        trimmed &&
        !trimmed.startsWith('#')
      ) {
        // Save the multiline content
        if (currentStep && multilineKey) {
          (currentStep as Record<string, unknown>)[multilineKey] =
            multilineContent.join('\n');
        }
        inMultiline = false;
        multilineContent = [];
        // Fall through to process this line normally
      } else {
        // Still in multiline, collect content
        if (trimmed && !trimmed.startsWith('#')) {
          multilineContent.push(trimmed);
        }
        continue;
      }
    }

    // Section header: [step:name] or [step:name with spaces]
    const sectionMatch = trimmed.match(/^\[step:(.+)\]$/);
    if (sectionMatch) {
      // Save previous step if exists
      if (currentStep?.name) {
        workflow.steps.push(currentStep as Step);
      }
      currentStep = { name: sectionMatch[1].trim(), run: '' };
      continue;
    }

    // Key-value pair: key: value
    const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;

      // Check for multiline indicator (empty value after colon)
      if (rawValue === '') {
        inMultiline = true;
        multilineKey = key;
        multilineContent = [];
        multilineIndent = line.search(/\S/);
        continue;
      }

      const value = parseValue(rawValue);

      if (currentStep) {
        (currentStep as Record<string, unknown>)[key] = value;
      } else {
        // Top-level property
        (workflow as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }

  // Handle any remaining multiline content
  if (inMultiline && currentStep && multilineKey) {
    (currentStep as Record<string, unknown>)[multilineKey] =
      multilineContent.join('\n');
  }

  // Don't forget the last step
  if (currentStep?.name) {
    workflow.steps.push(currentStep as Step);
  }

  return workflow;
}

function parseValue(raw: string): string | number | boolean {
  const trimmed = raw.trim();

  // Boolean
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Number (integers only for simplicity)
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);

  // Quoted string - remove quotes
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  // Unquoted string
  return trimmed;
}

/**
 * Interpolate variables in a string.
 * Supports: {env.VAR}, {branch}, {repo}
 */
export function interpolate(
  text: string,
  env: Record<string, string>,
  branch: string,
  repo: string
): string {
  return text.replace(/\{(\w+)(?:\.(\w+))?\}/g, (match, key, subkey) => {
    if (key === 'env' && subkey) {
      return env[subkey] ?? '';
    }
    if (key === 'branch') return branch;
    if (key === 'repo') return repo;
    return match; // Leave unknown vars as-is
  });
}

/**
 * Process a run line - handles env assignments and interpolation.
 * Returns null if the line is an env assignment (no command to run).
 */
export function processRunLine(
  line: string,
  env: Record<string, string>,
  branch: string,
  repo: string
): string | null {
  const trimmed = line.trim();

  // Check for env assignment: env.VAR = "value" or env.VAR = 'value'
  const envAssign = trimmed.match(/^env\.(\w+)\s*=\s*["']([^"']*)["']$/);
  if (envAssign) {
    env[envAssign[1]] = envAssign[2];
    return null; // Don't execute, just set env
  }

  // Check for env assignment without quotes: env.VAR = value
  const envAssignUnquoted = trimmed.match(/^env\.(\w+)\s*=\s*(\S+)$/);
  if (envAssignUnquoted) {
    env[envAssignUnquoted[1]] = envAssignUnquoted[2];
    return null;
  }

  return interpolate(trimmed, env, branch, repo);
}

/**
 * Evaluate a simple condition string.
 * Supports: branch == 'value', branch != 'value'
 */
export function evaluateCondition(
  condition: string,
  env: Record<string, string>,
  branch: string,
  _repo: string
): boolean {
  const trimmed = condition.trim();

  // Handle branch == 'value'
  const eqMatch = trimmed.match(/^branch\s*==\s*["']([^"']+)["']$/);
  if (eqMatch) {
    return branch === eqMatch[1];
  }

  // Handle branch != 'value'
  const neqMatch = trimmed.match(/^branch\s*!=\s*["']([^"']+)["']$/);
  if (neqMatch) {
    return branch !== neqMatch[1];
  }

  // Handle env.VAR == 'value'
  const envEqMatch = trimmed.match(/^env\.(\w+)\s*==\s*["']([^"']*)["']$/);
  if (envEqMatch) {
    return (env[envEqMatch[1]] ?? '') === envEqMatch[2];
  }

  // Handle env.VAR != 'value'
  const envNeqMatch = trimmed.match(/^env\.(\w+)\s*!=\s*["']([^"']*)["']$/);
  if (envNeqMatch) {
    return (env[envNeqMatch[1]] ?? '') !== envNeqMatch[2];
  }

  // Unknown condition format - default to true
  return true;
}
