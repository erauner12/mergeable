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
        id: "d1",
        isResolved: false,
        author: user1,
        createdAt: "2025-05-05T10:40:00Z",
        body: "A comment",
        url: "http://example.com/d1",
        filePath: "README.md",
      },
    ],
    participants: [
        { user: me, numComments: 1, lastActiveAt: "2025-05-05T10:30:00Z" },
        { user: user1, numComments: 1, lastActiveAt: "2025-05-05T10:40:00Z" },
    ]
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
        id: "d2",
        isResolved: false,
        author: user1,
        createdAt: "2025-05-05T10:30:00Z",
        body: "Another comment",
        url: "http://example.com/d2",
        filePath: "README.md",
      },
    ],
    participants: [
        { user: user1, numComments: 1, lastActiveAt: "2025-05-05T10:30:00Z" },
    ]
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
        id: "d3",
        isResolved: false,
        author: user2,
        createdAt: "2025-05-05T10:50:00Z",
        body: "Comment d3",
        url: "http://example.com/d3",
        filePath: "README.md",
      },
      {
        id: "d4",
        isResolved: false,
        author: user1,
        createdAt: "2025-05-05T10:40:00Z",
        body: "Comment d4",
        url: "http://example.com/d4",
        filePath: "README.md",
      },
    ],
    participants: [
        { user: me, numComments: 1, lastActiveAt: "2025-05-05T10:30:00Z" },
        { user: user1, numComments: 1, lastActiveAt: "2025-05-05T10:40:00Z" },
        { user: user2, numComments: 1, lastActiveAt: "2025-05-05T10:50:00Z" },
    ]
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
        id: "d5",
        isResolved: true,
        author: user1,
        createdAt: "2025-05-05T10:40:00Z",
        body: "Resolved comment",
        url: "http://example.com/d5",
        filePath: "README.md",
      },
    ],
    participants: [
        { user: me, numComments: 1, lastActiveAt: "2025-05-05T10:30:00Z" },
        { user: user1, numComments: 1, lastActiveAt: "2025-05-05T10:40:00Z" },
    ]
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
        id: "d6",
        isResolved: false,
        author: user1,
        createdAt: "2025-05-05T10:30:00Z",
        body: "Top level comment",
        url: "http://example.com/d6",
      },
    ],
    participants: [
        { user: user1, numComments: 1, lastActiveAt: "2025-05-05T10:30:00Z" },
    ]
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
        id: "d7",
        isResolved: false,
        author: me,
        createdAt: "2025-05-05T10:30:00Z",
        body: "My own comment",
        url: "http://example.com/d7",
        filePath: "README.md",
      },
    ],
    participants: [
        { user: me, numComments: 2, lastActiveAt: "2025-05-05T10:30:00Z" },
    ]
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
        id: "d8",
        isResolved: false,
        author: user1,
        createdAt: "2025-05-05T10:40:00Z",
        body: "Reply to reviewer",
        url: "http://example.com/d8",
        filePath: "README.md",
      },
    ],
    participants: [
        { user: me, numComments: 1, lastActiveAt: "2025-05-05T10:30:00Z" },
        { user: user1, numComments: 1, lastActiveAt: "2025-05-05T10:40:00Z" },
    ]
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
    url: `https://${host}/${repo}/pull/${number}`,
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
    branch: props?.branch ?? "main",
    files: props?.files ?? [],
    participants: props?.participants ?? [],
    uid: `${connection}:${id}`,
    host,
    sections: props?.sections ?? [],
    connection,
    ...props,
  };
}