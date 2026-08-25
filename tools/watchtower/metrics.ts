/**
 * Reads CI and deployment health from the GitHub Actions API.
 *
 * Deliberately boring: this module fetches and shapes data, nothing more. All
 * of the judgement lives in ../../monitoring/detect.ts, which is pure and
 * unit tested, and none of it lives in a model.
 */

export type WorkflowRun = {
  readonly id: number;
  readonly conclusion: string;
  readonly createdAt: string;
};

export type FetchOptions = {
  readonly repo: string;
  readonly workflow: string;
  readonly branch: string;
  readonly limit: number;
  readonly token: string | undefined;
};

type ApiRun = {
  id: number;
  conclusion: string | null;
  created_at: string;
};

export async function fetchRuns(options: FetchOptions): Promise<WorkflowRun[]> {
  const url = new URL(
    `https://api.github.com/repos/${options.repo}/actions/workflows/${options.workflow}/runs`,
  );
  url.searchParams.set('branch', options.branch);
  url.searchParams.set('per_page', String(options.limit));

  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(
      `GitHub API returned ${response.status} for ${options.workflow}: ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { workflow_runs?: ApiRun[] };
  const runs = body.workflow_runs ?? [];

  // The API returns newest first; the detector expects oldest to newest so
  // that "the latest sample" means what it says.
  return runs
    .map((r) => ({
      id: r.id,
      conclusion: r.conclusion ?? 'in_progress',
      createdAt: r.created_at,
    }))
    .reverse();
}
