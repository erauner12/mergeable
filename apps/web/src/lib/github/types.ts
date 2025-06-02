export type User = {
  id: string;
  name: string;
  avatarUrl: string;
  bot: boolean;
};

export type Team = {
  id: string;
  name: string;
};

export type Profile = {
  user: User;
  teams: Team[];
};

export type Review = {
  author: User | null;
  collaborator: boolean;
  approved: boolean;
};

// Replace existing Discussion type
export type Discussion = {
  id: string;
  author: User | null;
  createdAt: string;
  body: string;
  isResolved: boolean;
  url: string;
  // Note: 'file', 'numComments', 'participants', 'resolved' (as distinct from isResolved) are removed
  // as per the structure produced by client.ts#makePull and the plan's definition for Discussion.
  // This will likely impact attention.ts.
  filePath?: string; // ADDED for code comment threads
  line?: number; // ADDED for code comment threads
};

export type Participant = {
  user: User;
  numComments: number;
  lastActiveAt: string;
};

export type CheckState = "pending" | "error" | "failure" | "success";

export type Check = {
  name: string;
  state: CheckState;
  description: string | null;
  url: string | null;
};

export type PullState =
  | "draft"
  | "pending"
  | "approved"
  | "enqueued"
  | "merged"
  | "closed";

export type QueueState = "pending" | "mergeable" | "unmergeable";

export type PullProps = {
  id: string;
  repo: string;
  number: number;
  title: string;
  body: string | null;
  state: PullState;
  checkState: CheckState;
  queueState?: QueueState;
  createdAt: string;
  updatedAt: string;
  enqueuedAt?: string;
  mergedAt?: string;
  closedAt?: string;
  locked: boolean;
  url: string;
  labels: string[];
  additions: number;
  deletions: number;
  author: User | null;
  requestedReviewers: User[];
  requestedTeams: Team[];
  reviews: Review[];
  discussions: Discussion[]; // This now uses the new Discussion type
  checks: Check[];
  branch: string;
  files: string[];
  participants: Participant[]; // ADDED as per plan
};

export type Attention = {
  set: boolean;
  reason?: string;
};

export type Pull = PullProps & {
  uid: string;
  host: string;
  sections: string[];
  attention?: Attention;
  connection: string;
  schemaVersion?: string;
};