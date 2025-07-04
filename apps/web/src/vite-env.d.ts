/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COMMIT_SHA?: string;
  readonly MERGEABLE_NO_TELEMETRY?: string;
  readonly MERGEABLE_GITHUB_URLS?: string;
  readonly MERGEABLE_PR_SIZES?: string;
  readonly MERGEABLE_EXTENDED_SEARCH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
