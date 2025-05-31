import { expect, test } from "vitest";
import { DefaultGitHubClient } from "../../../src/lib/github/client";
import { setupRecording } from "./polly.js";

// Remove TEMP DEBUG console.log
// console.log("GH_TOKEN visible inside test:", !!process.env.GH_TOKEN);

setupRecording();

const endpoint = {
  // use your PAT when provided, otherwise fall back so replay mode still works
  auth: process.env.GH_TOKEN ?? "ghp_token",
  baseUrl: "https://api.github.com",
};

test("should return viewer", async () => {
  const client = new DefaultGitHubClient();

  const viewer = await client.getViewer(endpoint);

  expect(viewer).toEqual({
    user: expect.objectContaining({ // Updated assertion
      id: expect.any(String),
      name: expect.any(String),
      avatarUrl: expect.stringMatching(/^https:\/\/avatars\.githubusercontent\.com\//),
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

  pulls.forEach(p => {
    expect(p).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        url: expect.stringContaining('https://github.com/'),
        state: expect.stringMatching(/^(?:draft|pending|approved|enqueued|merged|closed)$/), // More complete regex for PullState
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
    expect(new Date(p.updatedAt).getTime())
      .toBeGreaterThanOrEqual(new Date(p.createdAt).getTime());
    if (p.mergedAt) {
      expect(p.state).toBe('merged');
    }
    if (p.closedAt && !p.mergedAt) { // If closed but not merged
        expect(p.state).toBe('closed');
    }
    if (p.state === 'enqueued') {
        expect(p.enqueuedAt).toEqual(expect.any(String));
    }
  });
});