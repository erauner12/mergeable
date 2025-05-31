import { beforeEach, afterEach } from "vitest";
import { Polly, type PollyConfig } from "@pollyjs/core";

/* eslint-disable */
Polly.register(require("@pollyjs/persister-fs"));
Polly.register(require("@pollyjs/adapter-fetch"));
/* eslint-enable */

/**
 * Sets up Polly for recording and replaying HTTP interactions in tests.
 *
 * @param {Object} [options={}] - Configuration options for the recording.
 * @param {string} [options.recordingName] - The name of the recording. If not provided, the suite name will be used.
 * @param {string} [options.recordingPath] - The path to save the recordings. If not provided, the recordings will be saved in a "__recordings__" directory next to the test file.
 * @see https://github.com/Netflix/pollyjs/issues/499
 */
export function setupRecording(
  options: { recordingName?: string; recordingPath?: string } = {},
) {
  let polly: Polly | undefined;
  let recordIfMissing = false;
  let mode: PollyConfig["mode"] = "replay";

  switch (process.env.POLLY_MODE) {
    case "record":
      mode = "record";
      break;
    case "replay":
      mode = "replay";
      break;
    case "offline":
      mode = "replay";
      recordIfMissing = false;
      break;
  }

  beforeEach((context) => {
    polly = new Polly(options.recordingName ?? context.task.name, {
      adapters: ["fetch"],
      mode,
      recordIfMissing,
      recordFailedRequests: true,
      persister: "fs",
      persisterOptions: {
        fs: {
          recordingsDir:
            options.recordingPath ??
            `${context.task.file.filepath.substring(0, context.task.file.filepath.lastIndexOf("/"))}/__recordings__`,
        },
      },
      matchRequestsBy: {
        method: true,
        headers: { exclude: ["authorization", "user-agent", "content-length"] },
        body: false,
        order: true,
        url: {
          protocol: true,
          username: true,
          password: true,
          hostname: true,
          port: true,
          pathname: true,
          query: true,
          hash: false,
        },
      },
      // Add filterHeaders to sanitize sensitive information before persisting
      filterHeaders: (headers) => {
        const newHeaders = { ...headers };
        if (newHeaders.authorization) {
          // Ensure authorization is an array of strings, as Polly might process it this way
          const authValues = Array.isArray(newHeaders.authorization) ? newHeaders.authorization : [newHeaders.authorization];
          newHeaders.authorization = authValues.map(value => {
            if (typeof value === 'string' && value.toLowerCase().startsWith('token ghp_')) {
              return 'token ghp_token'; // Replace with a placeholder
            }
            return value;
          });
          // If only one value after mapping, convert back to string for simplicity if that's the common case
          if (newHeaders.authorization.length === 1) {
            newHeaders.authorization = newHeaders.authorization[0];
          }
        }
        return newHeaders;
      },
    });
  });

  afterEach(async () => {
    if (polly) {
      await polly.stop();
    }
  });

  return;
}