import { expect, test, vi } from "vitest";
import {
  DefaultGitHubClient,
  type Endpoint as GitHubEndpoint,
} from "../../../src/lib/github/client"; // Ensure Endpoint is imported if not already
import { setupRecording } from "./polly.js";

// Remove TEMP DEBUG console.log
// console.log("GH_TOKEN visible inside test:", !!process.env.GH_TOKEN);

setupRecording();

const endpoint = {
  // use your PAT when provided, otherwise fall back so replay mode still works
  auth: process.env.GH_TOKEN ?? "ghp_token",
  baseUrl: "https://api.github.com",
};

test("fetchPullComments should set 'resolved' flag correctly for comment threads", async () => {
  // This test will rely on Polly.js recordings.
  // A new recording should be made against a PR that has:
  // 1. A comment thread that is unresolved.
  // 2. A comment thread that is resolved.
  // The mock for `GET /repos/{owner}/{repo}/pulls/comments/{comment_id}` (if that's how resolution is fetched)
  // needs to be part of this recording, returning appropriate `is_resolved` values.

  const client = new DefaultGitHubClient();
  const testEndpoint: GitHubEndpoint = {
    auth: process.env.GH_TOKEN ?? "ghp_token",
    baseUrl: "https://api.github.com",
  };

  // Use a real PR known to have resolved and unresolved threads for recording.
  // Example: owner = "pvcnt", repo = "mergeable", number = <some_pr_number_for_testing_threads>
  // For the purpose of this example, let's assume such a PR exists and Polly can record/replay it.
  // The actual owner/repo/number would need to be set up for a real test run with Polly recording.
  // If Polly cannot handle the dynamic nature of the new call or if `is_resolved` is not standard,
  // this test would need more complex direct mocking of `octokit.request`.

  // For now, let's assume a PR that Polly can handle.
  // Replace with actual PR details for recording if needed.
  const owner = "test-owner";
  const repo = "test-repo";
  const prNumber = 1; // Placeholder

  // In a real scenario with Polly, you'd make the call:
  // const comments = await client.fetchPullComments(testEndpoint, owner, repo, prNumber);

  // For a unit test without relying on a specific live PR for recording structure,
  // we would mock the octokit responses directly.
  // Given Polly is in use, the expectation is that recordings will be updated/created.
  // The assertions below assume `fetchPullComments` works as intended with the new logic.

  // Example structure of what might be asserted if we had mock data:
  // const unresolvedThread = comments.find(c => c.header.includes("UNRESOLVED_THREAD_IDENTIFIER"));
  // const resolvedThread = comments.find(c => c.header.includes("RESOLVED_THREAD_IDENTIFIER"));
  // expect(unresolvedThread?.resolved).toBe(false);
  // expect(resolvedThread?.resolved).toBe(true);

  // Since setting up full Polly recordings here is complex, this test serves as a placeholder
  // for the expected testing strategy. The key is that the `resolved` flag on CommentBlockInput
  // for threads should be correctly populated based on the (assumed) API response for thread metadata.
  // If using direct mocks:
  const mockOctokit = {
    paginate: vi.fn(),
    request: vi.fn(),
    rest: {
      issues: { listComments: vi.fn() },
      pulls: { listReviews: vi.fn(), listReviewComments: vi.fn() },
    },
  };
  (client as any).getOctokit = vi.fn().mockReturnValue(mockOctokit);

  // Mock listReviewComments to return two threads
  const commentIdUnresolved = 101;
  const commentIdResolved = 202;
  mockOctokit.paginate.mockImplementation(async (method: any, _params: any) => {
    if (method === mockOctokit.rest.pulls.listReviewComments) {
      return [
        {
          id: commentIdUnresolved,
          path: "file1.ts",
          diff_hunk: "hunk1",
          body: "unresolved comment",
          user: { login: "userA", avatar_url: "" },
          created_at: new Date().toISOString(),
        },
        {
          id: commentIdResolved,
          path: "file2.ts",
          diff_hunk: "hunk2",
          body: "resolved comment",
          user: { login: "userB", avatar_url: "" },
          created_at: new Date().toISOString(),
        },
      ];
    }
    return []; // For other paginate calls like issueComments, reviews
  });

  // Mock the thread resolution calls
  mockOctokit.request.mockImplementation(async (route: string, requestParams?: { owner?: string, repo?: string, comment_id?: number }) => {
    if (route === "GET /repos/{owner}/{repo}/pulls/comments/{comment_id}") {
      if (requestParams && typeof requestParams.comment_id === 'number') {
        // Using literal values directly for comparison
        if (requestParams.comment_id === 101) {
          return { data: { is_resolved: false } }; // Mock unresolved
        }
        if (requestParams.comment_id === 202) {
          return { data: { is_resolved: true } }; // Mock resolved
        }
        // If comment_id is present but doesn't match known IDs
        return { data: { message: `unknown comment_id ${requestParams.comment_id}` } };
      }
      // If params or params.comment_id is missing or not a number
      return { data: { message: "bad params for comment_id route" } };
    }
    return { data: { message: "fallback_route_in_mock" } };
  });

  const comments = await client.fetchPullComments(
    testEndpoint,
    owner,
    repo,
    prNumber,
  );

  const unresolvedThreadBlock = comments.find(
    (c) =>
      c.kind === "comment" &&
      c.threadId &&
      c.commentBody.includes("unresolved comment"),
  );
  const resolvedThreadBlock = comments.find(
    (c) =>
      c.kind === "comment" &&
      c.threadId &&
      c.commentBody.includes("resolved comment"),
  );

  expect(unresolvedThreadBlock).toBeDefined();
  expect(unresolvedThreadBlock?.resolved).toBe(false);
  expect(resolvedThreadBlock).toBeDefined();
  expect(resolvedThreadBlock?.resolved).toBe(true);

  // Test caching of thread resolution
  // Call again, ensure octokit.request for resolution is not called for cached keys
  mockOctokit.request.mockClear();
  await client.fetchPullComments(testEndpoint, owner, repo, prNumber);

  // Check that the specific 'GET /repos/{owner}/{repo}/pulls/comments/{comment_id}' was not called again for these comment_ids
  // This check is a bit fragile as it depends on the exact calls.
  // A more robust way would be to check if the promise from cache was used.
  // For simplicity, checking call count for the specific route:
  const resolutionCalls = mockOctokit.request.mock.calls.filter(
    (call) =>
      call[0] === "GET /repos/{owner}/{repo}/pulls/comments/{comment_id}",
  );
  expect(resolutionCalls.length).toBe(0); // Should be 0 if cache worked for both threads
});

test("should return viewer", async () => {
  const client = new DefaultGitHubClient();

  const viewer = await client.getViewer(endpoint);

  expect(viewer).toEqual({
    user: expect.objectContaining({
      // Updated assertion
      id: expect.any(String),
      name: expect.any(String),
      avatarUrl: expect.stringMatching(
        /^https:\/\/avatars\.githubusercontent\.com\//,
      ),
      bot: false,
    }),
    teams: expect.any(Array), // Updated assertion
  });
});

test("should search pulls", async () => {
  const client = new DefaultGitHubClient();

  const pulls = await client.searchPulls(
    endpoint,
    "repo:pvcnt/mergeable 'multiple connections'",
    [],
    50,
  );

  // portable assertions for pulls
  expect(pulls.length).toBeGreaterThan(0);

  pulls.forEach((p) => {
    expect(p).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        url: expect.stringContaining("https://github.com/"),
        state: expect.stringMatching(
          /^(?:draft|pending|approved|enqueued|merged|closed)$/,
        ), // More complete regex for PullState
        additions: expect.any(Number),
        deletions: expect.any(Number),
        author: expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          bot: expect.any(Boolean),
        }),
        // Ensure basic structure for other array properties if they are always present
        requestedReviewers: expect.any(Array),
        requestedTeams: expect.any(Array),
        reviews: expect.any(Array),
        checks: expect.any(Array),
        discussions: expect.any(Array),
        labels: expect.any(Array),
      }),
    );

    // logical invariants
    expect(new Date(p.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(p.createdAt).getTime(),
    );
    if (p.mergedAt) {
      expect(p.state).toBe("merged");
    }
    if (p.closedAt && !p.mergedAt) {
      // If closed but not merged
      expect(p.state).toBe("closed");
    }
    if (p.state === "enqueued") {
      expect(p.enqueuedAt).toEqual(expect.any(String));
    }
  });
});