import { expect, test } from "vitest";
import { isInAttentionSet } from "../../../src/lib/github/attention";
import type { Pull, PullState, User } from "../../../src/lib/github/types"; // Added PullState, User

const me: User = { id: "99", name: "test", avatarUrl: "", bot: false };
const user1: User = { id: "1", name: "test1", avatarUrl: "", bot: false };
const user2: User = { id: "2", name: "test2", avatarUrl: "", bot: false };
const viewer = { user: me, teams: [] };

test("should contain the author when pull is approved", () => {
  const pull = mockPull({ state: "approved", author: me });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: true, reason: "Pull request is approved" });
});

test("should contain only the author when pull is approved", () => {
  const pull = mockPull({ state: "approved" });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: false });
});

test("should contain the author when CI is failing", () => {
  const pull = mockPull({ author: me, checkState: "failure" });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: true, reason: "CI is failing" });
});

test("should contain only the author when CI is failing", () => {
  const pull = mockPull({ checkState: "failure" });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: false });
});

test("should contain the author when unmergeable", () => {
  const pull = mockPull({
    author: me,
    state: "enqueued",
    queueState: "unmergeable",
  });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({
    set: true,
    reason: "Pull request is unmergeable",
  });
});

test("should contain only the author when unmergeable", () => {
  const pull = mockPull({ state: "enqueued", queueState: "unmergeable" });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: false });
});

test("should contain a requested reviewer when pull is not approved", () => {
  const pull = mockPull({ state: "pending", requestedReviewers: [me] });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: true, reason: "Review is requested" });
});

test("should be empty when pull is draft", () => {
  const pull = mockPull({ state: "draft", author: me });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: false });
});

test("should be empty when pull is merged", () => {
  const pull = mockPull({ state: "merged", author: me });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: false });
});

test("should be empty when pull is closed", () => {
  const pull = mockPull({ state: "closed", author: me });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: false });
});

test("should contain the author when a user replied", () => {
  const pull = mockPull({
    state: "pending",
    author: me,
    discussions: [
      {
        resolved: false,
        numComments: 2,
        participants: [
          { user: me, numComments: 1, lastActiveAt: "2025-05-05T10:30:00Z" },
          { user: user1, numComments: 1, lastActiveAt: "2025-05-05T10:40:00Z" },
        ],
        file: { path: "README.md" },
      },
    ],
  });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: true, reason: "1 unread discussion" });
});

test("should contain the author when a user left a comment", () => {
  const pull = mockPull({
    state: "pending",
    author: me,
    discussions: [
      {
        resolved: false,
        numComments: 2,
        participants: [
          { user: user1, numComments: 1, lastActiveAt: "2025-05-05T10:30:00Z" },
        ],
        file: { path: "README.md" },
      },
    ],
  });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: true, reason: "1 unread discussion" });
});

test("should contain the author when a user left a comment and another user replied in different discussions", () => {
  const pull = mockPull({
    state: "pending",
    author: me,
    discussions: [
      {
        resolved: false,
        numComments: 2,
        participants: [
          { user: user2, numComments: 1, lastActiveAt: "2025-05-05T10:50:00Z" },
        ],
        file: { path: "README.md" },
      },
      {
        resolved: false,
        numComments: 2,
        participants: [
          { user: me, numComments: 1, lastActiveAt: "2025-05-05T10:30:00Z" },
          { user: user1, numComments: 1, lastActiveAt: "2025-05-05T10:40:00Z" },
        ],
        file: { path: "README.md" },
      },
    ],
  });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: true, reason: "2 unread discussions" });
});

test("should not contain the author when a user replied in a resolved discussion", () => {
  const pull = mockPull({
    state: "pending",
    author: me,
    discussions: [
      {
        resolved: true,
        numComments: 2,
        participants: [
          { user: me, numComments: 1, lastActiveAt: "2025-05-05T10:30:00Z" },
          { user: user1, numComments: 1, lastActiveAt: "2025-05-05T10:40:00Z" },
        ],
        file: { path: "README.md" },
      },
    ],
  });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: false });
});

test("should not contain the author when a user posted in the top-level discussion", () => {
  const pull = mockPull({
    state: "pending",
    author: me,
    discussions: [
      {
        resolved: false,
        numComments: 1,
        participants: [
          { user: user1, numComments: 1, lastActiveAt: "2025-05-05T10:30:00Z" },
        ],
      },
    ],
  });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: false });
});

test("should not contain the author when only the author posted", () => {
  const pull = mockPull({
    state: "pending",
    author: me,
    discussions: [
      {
        resolved: false,
        numComments: 2,
        participants: [
          { user: me, numComments: 2, lastActiveAt: "2025-05-05T10:30:00Z" },
        ],
        file: { path: "README.md" },
      },
    ],
  });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: false });
});

test("should contain a reviewer when a user replied", () => {
  const pull = mockPull({
    state: "pending",
    author: user1,
    reviews: [{ author: me, collaborator: true, approved: false }],
    discussions: [
      {
        resolved: false,
        numComments: 2,
        participants: [
          { user: me, numComments: 1, lastActiveAt: "2025-05-05T10:30:00Z" },
          { user: user1, numComments: 1, lastActiveAt: "2025-05-05T10:40:00Z" },
        ],
        file: { path: "README.md" },
      },
    ],
  });
  const attention = isInAttentionSet(viewer, pull);
  expect(attention).toEqual({ set: true, reason: "1 unread discussion" });
});

function mockPull(
  props?: Partial<Omit<Pull, "uid" | "url">> & { state?: PullState },
): Pull {
  const id = props?.id ?? "1";
  const repo = props?.repo ?? "pvcnt/mergeable";
  const number = props?.number ?? 1;
  const host = props?.host ?? "github.com";
  const connection = props?.connection ?? "1";

  return {
    id,
    repo,
    number,
    title: props?.title ?? "Pull request",
    body: props?.body ?? "",
    state: props?.state ?? "pending",
    checkState: props?.checkState ?? "pending",
    createdAt: props?.createdAt ?? "2024-08-05T15:57:00Z",
    updatedAt: props?.updatedAt ?? "2024-08-05T15:57:00Z",
    locked: props?.locked ?? false,
    url: `https://${host}/${repo}/pull/${number}`, // Construct URL
    additions: props?.additions ?? 0,
    deletions: props?.deletions ?? 0,
    author:
      props?.author === undefined
        ? { id: "1", name: "pvcnt", avatarUrl: "", bot: false }
        : props.author,
    requestedReviewers: props?.requestedReviewers ?? [],
    requestedTeams: props?.requestedTeams ?? [],
    reviews: props?.reviews ?? [],
    discussions: props?.discussions ?? [],
    checks: props?.checks ?? [],
    labels: props?.labels ?? [],
    branch: props?.branch ?? "main", // Ensure branch is always a string
    files: props?.files ?? [], // Ensure files is always an array
    uid: `${connection}:${id}`, // Construct UID
    host,
    sections: props?.sections ?? [],
    connection,
    // Spread other props that are part of Pull but not explicitly listed
    ...props,
  };
}
