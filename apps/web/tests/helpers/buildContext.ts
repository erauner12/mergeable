import { vi, type MockInstance } from 'vitest';
import * as gh from "../../src/lib/github/client";
import type { Pull } from "../../src/lib/github/types";
import * as renderTemplateModule from '../../src/lib/renderTemplate';
import type { PromptMode, ResolvedPullMeta } from "../../src/lib/repoprompt";
import { defaultPromptMode } from "../../src/lib/repoprompt";
import * as settings from '../../src/lib/settings';
import { analyseTemplate, type TemplateMeta } from "../../src/lib/templates";
import { mockPull } from '../testing'; // Assuming mockPull is in testing.ts
import { loadTemplate } from "./loadTemplate";


export interface TestContext {
  mockPullInstance: Pull & { branch: string };
  mockMeta: ResolvedPullMeta;
  spies: {
    renderTemplateSpy: MockInstance;
    getPullRequestDiffSpy: MockInstance;
    getCommitDiffSpy: MockInstance;
    listPrCommitsSpy: MockInstance;
    fetchPullCommentsSpy: MockInstance;
    getPromptTemplateSpy: MockInstance;
  };
  currentModeTemplate: { body: string; meta: TemplateMeta };
}

export function setupTestContext(mode: PromptMode = defaultPromptMode): TestContext {
  const mockPullInstance = mockPull({
    repo: 'owner/testrepo',
    number: 123,
    title: 'Test PR Title',
    body: 'Test PR body content.\n\nIt might have multiple lines.\n\nAnd even a fake files list:\n### files changed (2)\n- fake1.md\n- fake2.ts\nThis should be stripped.',
    branch: 'feature-branch',
    files: ['src/actualFile1.ts', 'README.md'], // files for meta.files
    author: { id: 'u-author', name: 'testauthor', avatarUrl: 'url', bot: false },
    createdAt: '2024-01-01T10:00:00Z',
    url: 'https://github.com/owner/testrepo/pull/123',
  });

  const mockMeta: ResolvedPullMeta = {
    owner: 'owner',
    repo: 'testrepo',
    branch: 'feature-branch',
    files: ['src/actualFile1.ts', 'README.md'],
    rootPath: '/tmp/testrepo',
  };

  // Spy on the actual renderTemplate function
  const renderTemplateSpy = vi.spyOn(renderTemplateModule, 'renderTemplate');
  
  const getPullRequestDiffSpy = vi.spyOn(gh, 'getPullRequestDiff').mockResolvedValue('diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new');
  const getCommitDiffSpy = vi.spyOn(gh, 'getCommitDiff').mockResolvedValue('commit diff content');
  const listPrCommitsSpy = vi.spyOn(gh, 'listPrCommits').mockResolvedValue([]);
  const fetchPullCommentsSpy = vi.spyOn(gh, 'fetchPullComments').mockResolvedValue([]);
  
  // Mock settings.getPromptTemplate to return the actual template body for the mode
  const templateBody = loadTemplate(mode);
  const getPromptTemplateSpy = vi.spyOn(settings, 'getPromptTemplate').mockResolvedValue(templateBody);


  return {
    mockPullInstance,
    mockMeta,
    spies: {
      renderTemplateSpy,
      getPullRequestDiffSpy,
      getCommitDiffSpy,
      listPrCommitsSpy,
      fetchPullCommentsSpy,
      getPromptTemplateSpy,
    },
    currentModeTemplate: {
        body: templateBody,
        meta: analyseTemplate(templateBody),
    }
  };
}
