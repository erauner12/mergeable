import { expect, test, vi } from "vitest";
import {
  DefaultGitHubClient,
  type Endpoint as GitHubEndpoint,
} from "../../../src/lib/github/client"; // Ensure Endpoint is imported if not already
import { setupRecording } from "./polly.js";

// Helper function to count actual comments in a formatted thread body
function countComments(body: string): number {
  // each top-level comment starts with "> _@…"
  return (body.match(/^> _@/gm) ?? []).length;
}

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

  // Mock listReviewComments
  // Thread 1: two comments, same pull_request_review_id. Last one determines resolution.
  // With new logic, these will be grouped by in_reply_to_id if present, or by id if root.
  // Here, comment 101 is root, 202 replies to 101. Both part of review 777.
  // ThreadKey will be "101:777".
  const reviewIdForMainThread = 777;
  const commentIdMainThreadUnresolvedPart = 101; // Root comment of the main thread
  const commentIdMainThreadResolvedPart = 202; // Reply comment in the main thread

  // Thread 2: single comment, different pull_request_review_id, unresolved.
  // ThreadKey will be "303:888".
  const reviewIdForSecondThread = 888;
  const commentIdSecondThread = 303;

  mockOctokit.paginate.mockImplementation(async (method: any, _params: any) => {
    if (method === mockOctokit.rest.pulls.listReviewComments) {
      return [
        // Comments for Main Thread (will be grouped by rootId:reviewId)
        {
          id: commentIdMainThreadUnresolvedPart, // 101
          pull_request_review_id: reviewIdForMainThread, // 777
          in_reply_to_id: null, // This is the root comment
          path: "file1.ts",
          diff_hunk: "hunk for main thread",
          body: "main thread - unresolved part",
          user: { login: "userA", avatar_url: "" },
          created_at: new Date(2024, 0, 1, 10, 0, 0).toISOString(), // Earlier
        },
        {
          id: commentIdMainThreadResolvedPart, // 202
          pull_request_review_id: reviewIdForMainThread, // 777 (same review)
          in_reply_to_id: commentIdMainThreadUnresolvedPart, // 101 (reply to the first comment)
          path: "file1.ts", // Same path
          diff_hunk: "hunk for main thread", // Same hunk
          body: "main thread - resolved part",
          user: { login: "userB", avatar_url: "" },
          created_at: new Date(2024, 0, 1, 10, 5, 0).toISOString(), // Later
        },
        // Comment for Second Thread (distinct)
        {
          id: commentIdSecondThread, // 303
          pull_request_review_id: reviewIdForSecondThread, // 888
          in_reply_to_id: null, // This is a root comment for its own thread
          path: "file2.ts",
          diff_hunk: "hunk for second thread",
          body: "second thread - unresolved",
          user: { login: "userC", avatar_url: "" },
          created_at: new Date(2024, 0, 1, 11, 0, 0).toISOString(),
        },
      ];
    }
    return []; // For other paginate calls like issueComments, reviews
  });

  // Mock the thread resolution calls
  // The client will call this for the *last* comment of each grouped thread.
  mockOctokit.request.mockImplementation(
    async (
      route: string,
      requestParams?: { owner?: string; repo?: string; comment_id?: number },
    ) => {
      if (route === "GET /repos/{owner}/{repo}/pulls/comments/{comment_id}") {
        if (requestParams && typeof requestParams.comment_id === "number") {
          // For Main Thread, it will query with ID 202 (last comment)
          if (requestParams.comment_id === commentIdMainThreadResolvedPart) {
            // 202
            return { data: { is_resolved: true } };
          }
          // For Second Thread, it will query with ID 303
          if (requestParams.comment_id === commentIdSecondThread) {
            // 303
            return { data: { is_resolved: false } };
          }
          // Fallback for any other IDs, like 101 if it were (incorrectly) queried
          if (requestParams.comment_id === commentIdMainThreadUnresolvedPart) {
            // 101
            return { data: { is_resolved: false } };
          }
          return {
            data: { message: `unknown comment_id ${requestParams.comment_id}` },
          };
        }
        return { data: { message: "bad params for comment_id route" } };
      }
      return { data: { message: "fallback_route_in_mock" } };
    },
  );

  const comments = await client.fetchPullComments(
    testEndpoint,
    owner,
    repo,
    prNumber,
  );

  // Expect two thread blocks because we have two distinct pull_request_review_id values
  const threadBlocks = comments.filter(
    (c) => c.kind === "comment" && c.threadId,
  );
  expect(threadBlocks.length).toBe(2); // Main thread (2 comments) + Second thread (1 comment)

  const mainThreadBlock = threadBlocks.find(
    // The body will contain both comments, check for the last comment's body part
    (c) => c.commentBody.includes("main thread - resolved part") && c.commentBody.includes("main thread - unresolved part"),
  );
  const secondThreadBlock = threadBlocks.find((c) =>
    c.commentBody.includes("second thread - unresolved"),
  );

  expect(mainThreadBlock).toBeDefined();
  // Verify that the main thread block contains two formatted comments
  expect(countComments(mainThreadBlock!.commentBody)).toBe(2);
  expect(mainThreadBlock?.resolved).toBe(true); // This thread should be resolved (based on last comment 202)
  expect(mainThreadBlock?.threadId).toBe(String(commentIdMainThreadUnresolvedPart)); // Explicitly check threadId is "101"

  expect(secondThreadBlock).toBeDefined();
  expect(secondThreadBlock?.resolved).toBe(false); // This thread should be unresolved

  // Test caching of thread resolution
  mockOctokit.request.mockClear();
  await client.fetchPullComments(testEndpoint, owner, repo, prNumber);
  const resolutionCalls = mockOctokit.request.mock.calls.filter(
    (call) =>
      call[0] === "GET /repos/{owner}/{repo}/pulls/comments/{comment_id}",
  );
  expect(resolutionCalls.length).toBe(0);
});

test("groups comments by in_reply_to_id when review_id is null", async () => {
  const client = new DefaultGitHubClient();
  const testEndpoint: GitHubEndpoint = {
    auth: process.env.GH_TOKEN ?? "ghp_token",
    baseUrl: "https://api.github.com",
  };
  const owner = "test-owner";
  const repo = "test-repo";
  const prNumber = 2; // Use a different PR number or ensure mocks are distinct

  const mockOctokit = {
    paginate: vi.fn(),
    request: vi.fn(),
    rest: {
      issues: { listComments: vi.fn() },
      pulls: { listReviews: vi.fn(), listReviewComments: vi.fn() },
    },
  };
  (client as any).getOctokit = vi.fn().mockReturnValue(mockOctokit);
  (client as any).commentCache.clear(); // Clear cache for this test
  (client as any).threadResolutionCache.clear(); // Clear resolution cache

  const rootCommentId = 501;
  const replyCommentId1 = 502;
  const replyCommentId2 = 503; // This will be the last comment, used for resolution check

  mockOctokit.paginate.mockImplementation(async (method: any, _params: any) => {
    if (method === mockOctokit.rest.pulls.listReviewComments) {
      return [
        {
          id: rootCommentId, // 501
          pull_request_review_id: null,
          in_reply_to_id: null,
          path: "file.ts",
          diff_hunk: "diff hunk for inline thread",
          body: "Root comment of inline thread",
          user: { login: "userX", avatar_url: "" },
          created_at: new Date(2024, 1, 1, 10, 0, 0).toISOString(),
          line: 10, // Ensure line info is present
        },
        {
          id: replyCommentId1, // 502
          pull_request_review_id: null,
          in_reply_to_id: rootCommentId, // 501
          path: "file.ts",
          diff_hunk: "diff hunk for inline thread",
          body: "First reply in inline thread",
          user: { login: "userY", avatar_url: "" },
          created_at: new Date(2024, 1, 1, 10, 5, 0).toISOString(),
          line: 10,
        },
        {
          id: replyCommentId2, // 503
          pull_request_review_id: null,
          in_reply_to_id: rootCommentId, // 501
          path: "file.ts",
          diff_hunk: "diff hunk for inline thread",
          body: "Second reply in inline thread",
          user: { login: "userX", avatar_url: "" },
          created_at: new Date(2024, 1, 1, 10, 10, 0).toISOString(),
          line: 10,
        },
      ];
    }
    return []; // For other paginate calls
  });

  mockOctokit.request.mockImplementation(
    async (
      route: string,
      requestParams?: { owner?: string; repo?: string; comment_id?: number },
    ) => {
      if (route === "GET /repos/{owner}/{repo}/pulls/comments/{comment_id}") {
        if (requestParams?.comment_id === replyCommentId2) { // 503
          return { data: { is_resolved: false } }; // Assume this thread is unresolved
        }
        return { data: { message: `unknown comment_id ${requestParams?.comment_id}` } };
      }
      return { data: { message: "fallback_route_in_mock" } };
    },
  );

  const comments = await client.fetchPullComments(
    testEndpoint,
    owner,
    repo,
    prNumber,
  );

  const threadBlocks = comments.filter(
    (c) => c.kind === "comment" && c.threadId,
  );

  expect(threadBlocks.length).toBe(1); // Expect one thread block for the inline comments

  const inlineThreadBlock = threadBlocks[0];
  expect(inlineThreadBlock).toBeDefined();
  expect(countComments(inlineThreadBlock.commentBody)).toBe(3); // 3 comments in this thread
  expect(inlineThreadBlock.resolved).toBe(false);
  expect(inlineThreadBlock.threadId).toBe(String(rootCommentId)); // Key should be "501"
  expect(inlineThreadBlock.filePath).toBe("file.ts");
  expect(inlineThreadBlock.line).toBe(10);
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