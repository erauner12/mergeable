# Mergeable

[![codecov](https://codecov.io/github/pvcnt/mergeable/graph/badge.svg?token=ZZN3FRNP86)](https://codecov.io/github/pvcnt/mergeable)

Mergeable is a better inbox for GitHub pull requests.

![Screenshot](docs/screenshot.png)

## Features

Mergeable provides the following features:

- Organize pull requests into sections, defined by flexible search queries.
- Data is all stored locally, in the browser storage.
- Keyboard shortcuts allow to navigate quickly.
- Connect to multiple GitHub instances, including GitHub Enterprise.
- Attention set, highlighting pull requests for which it is your turn to act.
- Does not require any GitHub app to be installed.

### Enhanced "Open in RepoPrompt" Integration
Mergeable now offers a more powerful "Open in RepoPrompt" experience:
- **Automatic Setup**: Includes commands to checkout the correct branch.
- **Customizable Base Prompt**: Configure a base prompt template in settings (e.g., for review guidelines).
- **Full Context**: The PR title, body, and the complete diff are pre-loaded into RepoPrompt.
- **Pre-selected Files**: All changed files in the PR are automatically selected.
- **Focused Workflow**: Leverages RepoPrompt's workspace feature for a streamlined experience.

*(TODO: Add screenshot of RepoPrompt with pre-filled data)*
*(TODO: Document the Base Prompt setting in the settings/user guide section)*

## Public instance

You can use the public instance hosted at https://app.usemergeable.dev

## Documentation

Documentation is available at https://www.usemergeable.dev

It includes a user guide and instructions to self-host your own instance.

## Run locally

This project is built using [PnPM](https://pnpm.io), [Turborepo](https://turbo.build/repo) and [Vite](https://vitejs.dev/).
It can be started locally with the following command:

```bash
pnpm run dev
```