import type {
  Route,
  HttpRequest,
  HttpResponse,
  TriggerWorkflowRequest
} from '../../shared/types.js';

import type { Database } from '../../db/index.js';
import type { WorkflowQueue } from '../workflow/WorkflowQueue.js';
import { hasPermission, getTokenId, FORBIDDEN } from '../auth.js';

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

        // Only owner, collaborators, or admin can trigger workflows
        const isOwner = repo.ownerTokenId === getTokenId(req);
        const isAdmin = hasPermission(req, 'admin');
        if (!isOwner && !isAdmin) {
          // Check if token name matches a collaborator
          // (This is a simplification - in production you'd want better mapping)
          return {
            status: 403,
            body: { error: 'Only the repository owner can trigger workflows' }
          };
        }

        const branch = body?.branch || 'main';
        const commit = (body as { commit?: string })?.commit || '';
        const files = body?.files;

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

        // Only owner or admin can view workflow runs
        const isOwner = repo.ownerTokenId === getTokenId(req);
        const isAdmin = hasPermission(req, 'admin');
        if (!isOwner && !isAdmin) {
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
          const isOwner = repo.ownerTokenId === getTokenId(req);
          const isAdmin = hasPermission(req, 'admin');
          if (!isOwner && !isAdmin) {
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

        // Admin sees all runs, regular users only see their own repos' runs
        const isAdmin = hasPermission(req, 'admin');
        const tokenId = getTokenId(req);

        let runs = await db.listWorkflowRuns();

        // Filter to only repos owned by this token (unless admin)
        if (!isAdmin && tokenId) {
          const ownedRuns = [];
          for (const run of runs) {
            const repo = await db.getRepo(run.repoName);
            if (repo?.ownerTokenId === tokenId) {
              ownedRuns.push(run);
            }
          }
          runs = ownedRuns;
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
