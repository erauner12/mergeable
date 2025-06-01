import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "octokit";
import { isNonNull, isNonNullish } from "remeda";
import {
  CheckConclusionState,
  PullRequestReviewDecision,
  PullRequestReviewState,
  SearchDocument,
  SearchFullDocument,
  StatusState,
  type CheckRun,
  type SearchFullQuery,
  type SearchQuery,
  type StatusContext,
} from "../../../generated/gql/graphql";
import { prepareQuery } from "./search";
import {
  hasLatestOpinionatedReviews,
  hasMergeQueueEntry,
  hasStatusCheckRollup,
} from "./type-guards";
import type {
  Check,
  CheckState,
  Discussion,
  Participant,
  Profile,
  PullProps,
  Team,
  User,
} from "./types";

const MyOctokit = Octokit.plugin(throttling);

export type Endpoint = {
  auth: string;
  baseUrl: string;
};

export interface GitHubClient {
  getViewer(endpoint: Endpoint): Promise<Profile>;
  searchPulls(
    endpoint: Endpoint,
    search: string,
    orgs: string[],
    limit: number,
  ): Promise<PullProps[]>;
}

type ArrayElement<T> = T extends (infer U)[] ? U : never;

// TODO: infer from GraphQL
type Actor =
  | {
      __typename: "Bot" | "Mannequin" | "User" | "EnterpriseUserAccount";
      id: string;
      login: string;
      avatarUrl: string;
    }
  | { __typename: "Organization" }
  | undefined
  | null;

export async function getPullRequestDiff(
  owner: string,
  repo: string,
  number: number,
  token?: string,
): Promise<string> {
  const octokit = token ? new Octokit({ auth: token }) : new Octokit(); // unauth → still fine for public repos
  const { data } = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    {
      owner,
      repo,
      pull_number: number,
      mediaType: { format: "diff" },
    },
  );
  // The Octokit types might return the diff data as `unknown` when mediaType.format is 'diff'
  return data as unknown as string;
}

export class DefaultGitHubClient implements GitHubClient {
  private octokits: Record<string, Octokit> = {};

  async getViewer(endpoint: Endpoint): Promise<Profile> {
    const octokit = this.getOctokit(endpoint);
    const userResponse = await octokit.rest.users.getAuthenticated();
    const user: User = {
      id: userResponse.data.node_id,
      name: userResponse.data.login,
      avatarUrl: userResponse.data.avatar_url,
      bot: false,
    };
    const teamsResponse = await octokit.paginate("GET /user/teams", {
      per_page: 100,
    });
    const teams: Team[] = teamsResponse.map((obj) => ({
      id: obj.node_id,
      name: `${obj.organization.login}/${obj.slug}`,
    }));
    return { user, teams };
  }

  async searchPulls(
    endpoint: Endpoint,
    search: string,
    orgs: string[],
    limit: number,
  ): Promise<PullProps[]> {
    const q = prepareQuery(search, orgs);
    const useFull = Boolean(import.meta.env.MERGEABLE_EXTENDED_SEARCH);
    const query = useFull
      ? (SearchFullDocument.toString() as string)
      : (SearchDocument.toString() as string);

    const octokit = this.getOctokit(endpoint);
    const data = await octokit.graphql<SearchQuery | SearchFullQuery>(query, {
      q,
      limit,
    });
    return (
      data.search.edges
        ?.filter(isNonNull)
        .map((n) => this.makePull(n))
        .filter(isNonNull) ?? []
    );
  }

  private getOctokit(endpoint: Endpoint): Octokit {
    const key = `${endpoint.baseUrl}:${endpoint.auth}`;
    if (!(key in this.octokits)) {
      this.octokits[key] = new MyOctokit({
        auth: endpoint.auth,
        baseUrl: endpoint.baseUrl,
        throttle: {
          // For now, allow retries in all situations.
          onRateLimit: (retryAfter, options, octokit) => {
            octokit.log.warn(
              `Request quota exhausted for request ${options.method} ${options.url}, retrying after ${retryAfter} seconds`,
            );
            return true;
          },
          onSecondaryRateLimit: (retryAfter, options, octokit) => {
            octokit.log.warn(
              `Secondary rate limit detected for request ${options.method} ${options.url}, retrying after ${retryAfter} seconds`,
            );
            return true;
          },
        },
      });
    }
    return this.octokits[key];
  }

  private makePull(
    res: ArrayElement<
      SearchQuery["search"]["edges"] | SearchFullQuery["search"]["edges"]
    >,
  ): PullProps | null {
    if (!res || res.node?.__typename !== "PullRequest") {
      return null;
    }
    const discussions: Discussion[] = [];
    let participants: Participant[] = [];
    let numComments = 0;

    // Add top-level comments.
    if (res.node.comments.nodes) {
      for (const comment of res.node.comments.nodes) {
        if (comment) {
          numComments++;
          this.addOrUpdateParticipant(
            participants,
            comment.author,
            comment.publishedAt ?? comment.createdAt,
          );
        }
      }
    }
    // Add reviews not available on this server version.
    if (participants) {
      discussions.push({ resolved: false, participants, numComments });
    }
    // Add review threads.
    if (res.node.reviewThreads?.nodes) {
      for (const thread of res.node.reviewThreads.nodes) {
        if (thread && thread.comments.nodes) {
          participants = [];
          for (const comment of thread.comments.nodes) {
            if (comment) {
              this.addOrUpdateParticipant(
                participants,
                comment.author,
                comment.publishedAt ?? comment.createdAt,
              );
            }
          }
          if (participants) {
            discussions.push({
              resolved: thread.isResolved,
              participants,
              numComments: thread.comments.nodes.length,
              file: {
                path: thread.path,
                line: isNonNullish(thread.startLine)
                  ? thread.startLine
                  : isNonNullish(thread.line)
                    ? thread.line
                    : undefined,
              },
            });
          }
        }
      }
    }

    // Cast node to a type that includes optional headRefName and files,
    // or use a more specific generated type if available and appropriate.
    const prNode = res.node as typeof res.node & {
      headRefName?: string;
      files?: { nodes?: ({ path: string } | null)[] };
    };

    return {
      id: prNode.id,
      repo: `${prNode.repository.owner.login}/${prNode.repository.name}`,
      number: prNode.number,
      title: prNode.title,
      body: prNode.body,
      state: prNode.isDraft
        ? "draft"
        : prNode.merged
          ? "merged"
          : prNode.closed
            ? "closed"
            : hasMergeQueueEntry(prNode)
              ? "enqueued"
              : prNode.reviewDecision == PullRequestReviewDecision.Approved
                ? "approved"
                : "pending",
      checkState: hasStatusCheckRollup(prNode)
        ? this.toCheckState(prNode.statusCheckRollup.state)
        : "pending",
      queueState: undefined,
      createdAt: this.toDate(prNode.createdAt),
      updatedAt: this.toDate(prNode.updatedAt),
      enqueuedAt: hasMergeQueueEntry(prNode)
        ? this.toDate(prNode.mergeQueueEntry.enqueuedAt)
        : undefined,
      mergedAt: prNode.mergedAt ? this.toDate(prNode.mergedAt) : undefined,
      closedAt: prNode.closedAt ? this.toDate(prNode.closedAt) : undefined,
      locked: prNode.locked,
      url: `${prNode.url}`,
      labels:
        prNode.labels?.nodes?.filter(isNonNullish).map((n) => n.name) ?? [],
      additions: prNode.additions,
      deletions: prNode.deletions,
      author: this.makeUser(prNode.author),
      requestedReviewers:
        prNode.reviewRequests?.nodes
          ?.map((n) => n?.requestedReviewer)
          .filter(isNonNullish)
          .filter((n) => n?.__typename != "Team")
          .map((n) => this.makeUser(n))
          .filter(isNonNull) ?? [],
      requestedTeams:
        prNode.reviewRequests?.nodes
          ?.map((n) => n?.requestedReviewer)
          .filter(isNonNullish)
          .filter((n) => n.__typename == "Team")
          .map((n) => ({ id: n.id, name: n.combinedSlug })) ?? [],
      reviews: hasLatestOpinionatedReviews(prNode)
        ? (() => {
            type Latest = NonNullable<
              NonNullable<
                (typeof prNode.latestOpinionatedReviews)["nodes"]
              >[number]
            >;
            return (
              prNode.latestOpinionatedReviews.nodes
                ?.filter(isNonNullish)
                .filter(
                  (n: Latest) =>
                    n.state !== PullRequestReviewState.Dismissed &&
                    n.state !== PullRequestReviewState.Pending,
                )
                .map((n: Latest) => ({
                  author: this.makeUser(n.author),
                  collaborator: n.authorCanPushToRepository,
                  approved: n.state === PullRequestReviewState.Approved,
                })) ?? []
            );
          })()
        : [],
      checks: hasStatusCheckRollup(prNode)
        ? (() => {
            const nodes =
              prNode.statusCheckRollup.contexts?.nodes?.filter(isNonNullish) ??
              [];
            return nodes.map((n) => this.makeCheck(n));
          })()
        : [],
      discussions,
      // Add new fields here
      branch: prNode.headRefName ?? "", // Provide a fallback if headRefName might be undefined
      files:
        prNode.files?.nodes
          ?.filter(isNonNullish)
          .map((f: { path: string }) => f.path) ?? [],
    };
  }

  private makeUser(obj: Actor): User | null {
    if (
      obj?.__typename === "Bot" ||
      obj?.__typename === "Mannequin" ||
      obj?.__typename === "User" ||
      obj?.__typename === "EnterpriseUserAccount"
    ) {
      return {
        id: obj.id,
        name: obj.login,
        avatarUrl: `${obj.avatarUrl}`,
        bot: obj.__typename === "Bot",
      };
    } else {
      // No user provided, or unsupported type.
      return null;
    }
  }

  private makeCheck(obj: CheckRun | StatusContext): Check {
    if ("name" in obj) {
      return {
        name: obj.name,
        state:
          obj.conclusion === CheckConclusionState.Success
            ? "success"
            : "pending",
        description: obj.title ?? obj.name,
        url: obj.url ? String(obj.url) : null,
      };
    } else {
      return {
        name: obj.context,
        state: this.toCheckState(obj.state),
        description: obj.description ?? obj.context,
        url: obj.targetUrl ? String(obj.targetUrl) : null,
      };
    }
  }

  private toDate(v: unknown): string {
    if (typeof v === "number") {
      return new Date(v).toISOString();
    } else if (v instanceof Date) {
      return v.toISOString();
    } else {
      return String(v);
    }
  }

  private maxDate(a: string, b: string) {
    const da = new Date(a);
    const db = new Date(b);
    return da > db ? a : b;
  }

  private toCheckState(v: StatusState | null | undefined): CheckState {
    return v == StatusState.Error
      ? "error"
      : v == StatusState.Failure
        ? "failure"
        : v == StatusState.Success
          ? "success"
          : "pending";
  }

  private addOrUpdateParticipant(
    participants: Participant[],
    actor: Actor,
    activeAt: unknown,
  ) {
    const user = this.makeUser(actor);
    if (user) {
      const participant = participants.find((p) => p.user.id === user.id);
      if (participant) {
        participant.numComments += 1;
        participant.lastActiveAt = this.maxDate(
          participant.lastActiveAt,
          this.toDate(activeAt),
        );
      } else {
        participants.push({
          user,
          numComments: 1,
          lastActiveAt: this.toDate(activeAt),
        });
      }
    }
  }
}
