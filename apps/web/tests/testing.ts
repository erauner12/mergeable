import type { Endpoint, GitHubClient } from "../src/lib/github/client";
import type { Profile, Pull, PullProps } from "../src/lib/github/types";
import type { Connection, Section } from "../src/lib/types";
import type { CommentBlockInput } from "../src/lib/repoprompt"; // ADDED

export function mockPull(props?: Omit<Partial<Pull>, "uid">): Pull {
  const id = props?.id ?? "PR_1";
  const repo = props?.repo ?? "pvcnt/mergeable";
  const number = props?.number ?? 1;
  const host = props?.host ?? "github.com";
  const connection = props?.connection ?? "1";
  const finalUrl = props?.url ?? `https://${host}/${repo}/pull/${number}`; // Hoisted and respects override
  return {
    id,
    repo,
    number,
    title: "Pull request",
    body: "",
    state: "pending",
    checkState: "pending",
    createdAt: "2024-08-05T15:57:00Z",
    updatedAt: "2024-08-05T15:57:00Z",
    url: finalUrl, // Use the computed finalUrl
    locked: false,
    additions: 0,
    deletions: 0,
    author: { id: "u1", name: "pvcnt", avatarUrl: "", bot: false },
    requestedReviewers: [],
    requestedTeams: [],
    reviews: [],
    discussions: [],
    checks: [],
    labels: [],
    branch: props?.branch ?? "main",
    files: props?.files ?? ["file1.ts", "file2.md"],
    participants: props?.participants ?? [], // ADDED
    uid: `${connection}:${id}`,
    host,
    sections: [],
    connection,
    ...props,
  };
}

export function mockSection(props?: Partial<Section>): Section {
  return {
    id: "",
    label: "Section",
    search: "author:@me",
    position: 0,
    attention: true,
    ...props,
  };
}

export function mockConnection(props?: Partial<Connection>): Connection {
  return {
    id: "",
    label: "",
    baseUrl: "https://api.github.com",
    host: "github.com",
    auth: "ghp_xxx",
    orgs: [],
    ...props,
  };
}

export class TestGitHubClient implements GitHubClient {
  private pullsBySearch: Record<string, PullProps[]> = {};

  getViewer(endpoint: Endpoint): Promise<Profile> {
    return Promise.resolve({
      user: {
        id: "u1",
        name: `test[${endpoint.baseUrl}]`,
        avatarUrl: "",
        bot: false,
      },
      teams: [{ id: "t1", name: "test" }],
    });
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  searchPulls(
    endpoint: Endpoint,
    search: string,
    _orgs: string[], // prefixed ⇒ "used"
    _limit: number, // prefixed ⇒ "used"
  ): Promise<PullProps[]> {
  /* eslint-enable @typescript-eslint/no-unused-vars */
    const pulls =
      this.pullsBySearch[`${endpoint.baseUrl}:${endpoint.auth}:${search}`] ||
      [];
    return Promise.resolve(pulls);
  }

  // ADDED fetchPullComments method
  async fetchPullComments(
    _endpoint: Endpoint,
    _owner: string,
    _repo: string,
    _number: number,
  ): Promise<CommentBlockInput[]> {
    return Promise.resolve([]); // Return empty array as per plan
  }

  setPullsBySearch(endpoint: Endpoint, search: string, pulls: PullProps[]) {
    this.pullsBySearch[`${endpoint.baseUrl}:${endpoint.auth}:${search}`] =
      pulls;
  }

  clear(): void {
    this.pullsBySearch = {};
  }
}