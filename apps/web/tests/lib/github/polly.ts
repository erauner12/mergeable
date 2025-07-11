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
    });

    /** redact PAT just before the recording is written to disk */
    polly.server.any().on("beforePersist", (_request, recording) => {
      const auth = recording.request.headers?.authorization as
        | string
        | string[]
        | undefined;

      const values = Array.isArray(auth) ? auth : [auth];
      if (values?.some(v => typeof v === "string" && v.toLowerCase().startsWith("token ghp_"))) {
        recording.request.headers.authorization = "token ghp_token";
      }
    });
  });

  afterEach(async () => {
    if (polly) {
      await polly.stop();
    }
  });

  return;
}