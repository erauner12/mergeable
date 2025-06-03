# Prompt Templates

This directory contains the Markdown-based prompt templates used by the application. These templates are processed by `renderTemplate.ts` and populated with dynamic data by `repoprompt.ts`.

## Standard Template Contract (Mandatory)

All prompt templates, including any custom templates configured by users, **must** adhere to the "standard template" contract. Failure to do so will result in an error, and RepoPrompt will refuse to generate the prompt.

A standard template **must include all** of the following tokens, typically within their own markdown sections:

1.  `{{SETUP}}`:
    *   **Content**: Provides setup instructions, like `cd` into the repository and `git checkout` the relevant branch.
    *   **Heading**: The template must include its own heading for this section (e.g., `## SETUP`).
    *   **Placement**: Usually at the beginning of the prompt, often within a ` ```bash ... ``` ` block.

2.  One of `{{PR_DETAILS}}` or `{{prDetailsBlock}}`:
    *   **Content**: The pull request title and body (the body will have any "### files changed" section automatically stripped from it before being inserted).
    *   **Requirement**: Exactly one of these tokens must be present. Using both or neither will cause an error.
    *   **Recommendation**: Prefer `{{PR_DETAILS}}` for built-in and new custom templates. `{{prDetailsBlock}}` is supported for flexibility with user-defined templates.
    *   **Heading**: The template must include its own heading for this section (e.g., `### PR details`).

3.  `{{FILES_LIST}}`:
    *   **Content**: A list of files changed in the PR. If no files were changed, it will contain a message like "No files changed in this PR.".
    *   **Heading**: The template must include its own heading for this section (e.g., `### files changed`).

4.  `{{DIFF_CONTENT}}`:
    *   **Content**: The actual diff content (full PR diff, commit diffs, etc., based on selections). This may be an empty string if no diffs are requested/available. `renderTemplate.ts` will remove the line if the token is empty.
    *   **Heading**: The template **must** include its own heading for this section (e.g., `### diff`). The content injected into `{{DIFF_CONTENT}}` itself (e.g., from `formatPromptBlock`) may also contain its own headers (like `### FULL PR DIFF`).
    *   ❗️**Important**: Never embed raw diffs (e.g., `diff --git ...`) directly into the template. Always use the `{{DIFF_CONTENT}}` token to ensure diffs are dynamically injected.

5.  `{{LINK}}`:
    *   **Content**: A direct link to the pull request on the SCM platform (e.g., GitHub).
    *   **Heading**: No specific heading is required by the system for this token, but it's often placed at the end, after the diff section.

**Note on Block Separation**: Blocks of content generated to fill these tokens (e.g., multiple diffs within `{{DIFF_CONTENT}}`, or when combining multiple selected items in the UI) are typically separated by a double newline. This standard separator is defined as `SECTION_SEPARATOR` in `apps/web/src/lib/utils/promptFormat.ts`. While `renderTemplate.ts` includes logic to normalize excessive newlines, custom templates or manual prompt construction should ideally respect this convention for clarity and consistency.

### Standard Template Skeleton Example:

All built-in templates follow this general structure. Custom templates should also adhere to it.

```markdown
## SETUP
` ```bash
{{SETUP}}
` ```

### TASK
(Optional: Any specific instructions for the LLM for this prompt mode)

### PR details
{{PR_DETAILS}}

### files changed
{{FILES_LIST}}

### diff
{{DIFF_CONTENT}}

{{LINK}}
```

*(You can add additional prose or markdown elements around these core blocks as needed for your specific prompt's task.)*

## Token Details

-   `{{SETUP}}`: Bash commands for local repository setup.
-   `{{PR_DETAILS}}`: Primary token for PR title and (stripped) body.
-   `{{prDetailsBlock}}`: Alternative to `{{PR_DETAILS}}`. If `{{PR_DETAILS}}` is in the template, this slot will be empty. If `{{prDetailsBlock}}` is used (and `{{PR_DETAILS}}` is not), this slot receives the PR details.
-   `{{FILES_LIST}}`: List of changed files, or a "no files changed" message.
-   `{{DIFF_CONTENT}}`: Selected diff(s).
-   `{{LINK}}`: URL to the PR.

## Custom Templates

If you customize templates via the application settings:
-   Your custom template **must** include all the tokens (`SETUP`, one of `PR_DETAILS`/`prDetailsBlock`, `FILES_LIST`, `DIFF_CONTENT`, `LINK`).
-   The system no longer wraps "fragment" templates. Your template is used as-is after token replacement.
-   If your custom template does not meet the standard contract, `buildRepoPromptText` will throw an error.

## Linting
A linting script (`scripts/lint-templates.ts`) is available to check if the default templates conform to these rules.
