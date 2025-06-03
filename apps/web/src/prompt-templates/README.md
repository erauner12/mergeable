# Prompt Templates

This directory contains the Markdown-based prompt templates used by the application. These templates are processed by `renderTemplate.ts` and populated with dynamic data by `repoprompt.ts`.

## Standard Tokens

The following tokens are typically available for use in your templates:

-   `{{SETUP}}`: Provides setup instructions, like `cd` into the repository and `git checkout` the relevant branch. This is usually placed at the beginning of the prompt, often within a ` ```bash ... ``` ` block.
-   `{{PR_DETAILS}}`: Contains the pull request title and body. This is the primary way to include PR information.
-   `{{FILES_LIST}}`: A list of files changed in the PR. This is typically populated if the full PR diff is not being included (e.g., when `includePr: false` in `DiffOptions`).
-   `{{DIFF_CONTENT}}`: The actual diff content, which could be the full PR diff, last commit diff, or specific commit diffs, depending on user selection. This is usually placed within a ` ```diff ... ``` ` block.
-   `{{LINK}}`: A direct link to the pull request on the SCM platform (e.g., GitHub).

## Alternative PR Details Token

-   `{{prDetailsBlock}}`: This is an alternative token for including PR details.
    -   If your template includes `{{PR_DETAILS}}`, the `{{prDetailsBlock}}` token will be replaced with an empty string (and the line subsequently removed if it becomes empty). This prevents duplication of PR details.
    -   If your template *does not* include `{{PR_DETAILS}}` but *does* include `{{prDetailsBlock}}`, then `{{prDetailsBlock}}` will be populated with the PR details.
    -   **Recommendation**: Prefer `{{PR_DETAILS}}` for clarity. `{{prDetailsBlock}}` exists for specific layout needs or legacy reasons but offers no advantage over `{{PR_DETAILS}}` with the current rendering logic.

## Template Structure

### Standard Templates
A "standard" template is one that includes `{{SETUP}}`, `{{LINK}}`, and at least one of (`{{PR_DETAILS}}` or `{{prDetailsBlock}}`). Such templates are used as-is after token replacement. The default templates provided in this directory are standard.

Example (`review.md`):
```markdown
## SETUP
` ```bash
{{SETUP}}
` ```

### TASK
You are reviewing the following pull-request diff...

{{PR_DETAILS}}

{{FILES_LIST}}

{{DIFF_CONTENT}}

{{LINK}}
```

### Non-Standard Templates (Fragments)
If a template stored in settings (e.g., customized by a user) does not meet the "standard" criteria (e.g., it's just a task description), the system will wrap it:
1.  A `## SETUP` section with the `{{SETUP}}` content will be prepended.
2.  The user's custom template content will be rendered (with tokens like `{{PR_DETAILS}}`, `{{DIFF_CONTENT}}`, etc., replaced).
3.  If the user's custom template did not use `{{PR_DETAILS}}` or `{{prDetailsBlock}}`, the PR details content will be appended after their custom content.
4.  A `{{LINK}}` section will be appended at the very end.

This ensures that critical information (setup, PR context, link) is always part of the prompt, even if the user provides a minimal template focusing only on the task.

## Avoiding Duplication

Using both `{{PR_DETAILS}}` and `{{prDetailsBlock}}` in any template (standard or fragment) will result in the PR details appearing only once, where `{{PR_DETAILS}}` takes precedence.

The system prevents common duplication scenarios:
- **PR details rendered twice**: Standard templates use canonical tokens, preventing fallback append logic
- **Blocks added multiple times**: The `pushUnique()` function and Map-based deduplication ensure blocks appear only once
- **Last commit diff + full PR diff**: Guard rails ensure these are mutually exclusive
- **Legacy template keys**: Only the newest template key is used, preventing multiple versions from being loaded

## Best Practices

1. Use `{{PR_DETAILS}}` instead of `{{prDetailsBlock}}` for clarity
2. Include all standard tokens (`{{SETUP}}`, `{{PR_DETAILS}}`, `{{LINK}}`) to create a "standard" template
3. Keep templates focused on the task while letting the system handle structural elements
4. Test custom templates to ensure they don't accidentally include duplicate content

### Potential Edge Cases

**Custom templates with both tokens**: If a user creates a template that includes both `{{PR_DETAILS}}` and `{{prDetailsBlock}}`, the system will render PR details only once at the `{{PR_DETAILS}}` location, and `{{prDetailsBlock}}` will be replaced with an empty string.

**Mis-matched prompt mode keys**: The system uses lowercased enum literals for prompt modes. Ensure consistency to avoid fallback behavior.

**Future block additions**: When adding new block types, always use `pushUnique()` to prevent accidental duplicates in the blocks array.
