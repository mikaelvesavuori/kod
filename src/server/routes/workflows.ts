import type {
  Route,
  HttpRequest,
  HttpResponse,
  TriggerWorkflowRequest
} from '../../shared/types.js';

import type { Database } from '../db/index.js';
import type { WorkflowQueue } from '../workflow/WorkflowQueue.js';
import { hasPermission, FORBIDDEN } from '../auth.js';
import { hasRepoAccess } from '../access.js';
import { isValidBranchName, isValidCommit } from '../workflow/validation.js';

export function createWorkflowRoutes(
  db: Database,
  queue: WorkflowQueue
): Route[] {
  return [
    // POST /repos/:name/workflows - Trigger workflow
    {
      method: 'POST',
      pattern: /^\/repos\/(?<name>[^/]+)\/workflows\/?$/,
      handler: async (
        req: HttpRequest,
        params: Record<string, string>
      ): Promise<HttpResponse> => {
        // Require workflow:trigger permission
        if (!hasPermission(req, 'workflow:trigger')) {
          return FORBIDDEN;
        }

        const body = req.body as TriggerWorkflowRequest;

        const repo = await db.getRepo(params.name);
        if (!repo) {
          return { status: 404, body: { error: 'Repository not found' } };
        }

        if (
          !(await hasRepoAccess(req, db, repo, {
            permission: 'workflow:trigger',
            allowCollaborator: true
          }))
        ) {
          return FORBIDDEN;
        }

        const branch = body?.branch || 'main';
        const commit = (body as { commit?: string })?.commit || '';
        const files = body?.files;

        if (!(await isValidBranchName(branch))) {
          return { status: 400, body: { error: 'Invalid branch name' } };
        }
        if (!isValidCommit(commit)) {
          return { status: 400, body: { error: 'Invalid commit' } };
        }
        if (
          files !== undefined &&
          (!Array.isArray(files) ||
            files.some((file) => typeof file !== 'string'))
        ) {
          return {
            status: 400,
            body: { error: 'Workflow files must be strings' }
          };
        }

        const runId = await queue.enqueue(params.name, branch, commit, files);

        return {
          status: 202,
          body: {
            id: runId,
            status: 'queued',
            message: 'Workflow queued for execution'
          }
        };
      }
    },

    // GET /repos/:name/workflows - List workflow runs for repo
    {
      method: 'GET',
      pattern: /^\/repos\/(?<name>[^/]+)\/workflows\/?$/,
      handler: async (
        req: HttpRequest,
        params: Record<string, string>
      ): Promise<HttpResponse> => {
        // Require workflow:read permission
        if (!hasPermission(req, 'workflow:read')) {
          return FORBIDDEN;
        }

        const repo = await db.getRepo(params.name);
        if (!repo) {
          return { status: 404, body: { error: 'Repository not found' } };
        }

        if (
          !(await hasRepoAccess(req, db, repo, {
            permission: 'workflow:read',
            allowCollaborator: true
          }))
        ) {
          return FORBIDDEN;
        }

        const runs = await db.listWorkflowRuns(params.name);
        const queueStatus = queue.getStatus(params.name);

        // Sort by most recent first
        runs.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

        return {
          status: 200,
          body: {
            runs: runs.slice(0, 50), // Limit to last 50
            queue: queueStatus
          }
        };
      }
    },

    // GET /repos/:name/workflows/:id - Get specific workflow run
    {
      method: 'GET',
      pattern: /^\/repos\/(?<name>[^/]+)\/workflows\/(?<id>[^/]+)\/?$/,
      handler: async (
        req: HttpRequest,
        params: Record<string, string>
      ): Promise<HttpResponse> => {
        // Require workflow:read permission
        if (!hasPermission(req, 'workflow:read')) {
          return FORBIDDEN;
        }

        const run = await db.getWorkflowRun(params.id);

        if (!run) {
          return { status: 404, body: { error: 'Workflow run not found' } };
        }

        if (run.repoName !== params.name) {
          return { status: 404, body: { error: 'Workflow run not found' } };
        }

        // Verify ownership for specific run access
        const repo = await db.getRepo(params.name);
        if (repo) {
          if (
            !(await hasRepoAccess(req, db, repo, {
              permission: 'workflow:read',
              allowCollaborator: true
            }))
          ) {
            return FORBIDDEN;
          }
        }

        return { status: 200, body: run };
      }
    },

    // GET /workflows/status - Get overall workflow status (all repos)
    {
      method: 'GET',
      pattern: /^\/workflows\/status\/?$/,
      handler: async (req: HttpRequest): Promise<HttpResponse> => {
        // Require workflow:read permission
        if (!hasPermission(req, 'workflow:read')) {
          return FORBIDDEN;
        }

        // Admin sees all runs, other tokens see runs for repos they can access.
        const isAdmin = hasPermission(req, 'admin');

        let runs = await db.listWorkflowRuns();

        if (!isAdmin) {
          const visibleRuns = [];
          for (const run of runs) {
            const repo = await db.getRepo(run.repoName);
            if (
              repo &&
              (await hasRepoAccess(req, db, repo, {
                permission: 'workflow:read',
                allowCollaborator: true
              }))
            ) {
              visibleRuns.push(run);
            }
          }
          runs = visibleRuns;
        }

        // Group by status
        const byStatus = {
          queued: 0,
          running: 0,
          completed: 0,
          failed: 0
        };

        for (const run of runs) {
          byStatus[run.status]++;
        }

        // Recent runs
        const recent = runs
          .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
          .slice(0, 10);

        return {
          status: 200,
          body: {
            summary: byStatus,
            recent
          }
        };
      }
    }
  ];
}
