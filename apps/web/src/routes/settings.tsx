import { Button, Card, FormGroup, H3, InputGroup } from "@blueprintjs/core";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { isTruthy } from "remeda";
import ConfirmDialog from "../components/ConfirmDialog";
import ConnectionDialog from "../components/ConnectionDialog";
import ConnectionTable from "../components/ConnectionTable";
import { gitHubClient } from "../github";
import {
  deleteConnection,
  resetSections,
  saveConnection,
} from "../lib/mutations";
import { useConnections } from "../lib/queries";
import { getDefaultRoot, setDefaultRoot } from "../lib/settings";
import { useToaster } from "../lib/toaster";
import type { Connection, ConnectionProps } from "../lib/types";
import styles from "./settings.module.scss";

export default function Settings() {
  const [isEditing, setEditing] = useState(false);
  const [isResetting, setResetting] = useState(false);
  const connections = useConnections();
  const navigate = useNavigate();
  const toaster = useToaster();

  const [cloneRoot, setCloneRoot] = useState<string>("");
  const [initialCloneRoot, setInitialCloneRoot] = useState<string>("");

  useEffect(() => {
    getDefaultRoot()
      .then((root) => {
        setCloneRoot(root);
        setInitialCloneRoot(root);
      })
      .catch(console.error);
  }, []);

  const handleSaveCloneRoot = async () => {
    try {
      await setDefaultRoot(cloneRoot);
      setInitialCloneRoot(cloneRoot); // Update initial state on successful save
      toaster?.show({
        message: "Default clone root saved.",
        intent: "success",
      });
    } catch (error) {
      console.error("Failed to save clone root:", error);
      toaster?.show({
        message: "Failed to save default clone root.",
        intent: "danger",
      });
    }
  };

  const allowedUrls = isTruthy(import.meta.env.MERGEABLE_GITHUB_URLS)
    ? import.meta.env.MERGEABLE_GITHUB_URLS.split(",")
    : undefined;

  const handleNew = async (props: ConnectionProps) => {
    const viewer = await gitHubClient.getViewer(props);
    await saveConnection({ id: "", ...props, viewer });
  };
  const handleEdit = async (previous: Connection, props: ConnectionProps) => {
    const viewer = await gitHubClient.getViewer(props);
    await saveConnection({ ...previous, ...props, viewer });
  };
  const handleDelete = async (connection: Connection) => {
    await deleteConnection(connection);
  };
  const handleReset = async () => {
    await resetSections();
    toaster?.show({
      message: "Configuration has been reset to factory settings",
      intent: "success",
    });
    await navigate("/inbox");
  };

  return (
    <>
      <div className={styles.container}>
        <div className={styles.header}>
          <H3 className={styles.title}>Connections</H3>
          <Button
            text="New connection"
            icon="plus"
            onClick={() => setEditing(true)}
          />
        </div>

        <ConnectionDialog
          title="New connection"
          allowedUrls={allowedUrls}
          isOpen={isEditing}
          onClose={() => setEditing(false)}
          onSubmit={handleNew}
        />

        <Card>
          <ConnectionTable
            connections={connections.data}
            onSubmit={handleEdit}
            onDelete={handleDelete}
          />
        </Card>

        <div className={styles.header}>
          <H3 className={styles.title}>Repository Settings</H3>
        </div>
        <Card className={styles.settingsCard}>
          <FormGroup
            label="Default Clone Root"
            helperText="The default local directory where repositories are cloned (e.g., ~/git, /projects)."
            labelFor="clone-root-input"
            className={styles.formGroup}
          >
            <InputGroup
              id="clone-root-input"
              value={cloneRoot}
              onChange={(e) => setCloneRoot(e.target.value)}
              placeholder="e.g., ~/git/work"
              className={styles.input}
            />
          </FormGroup>
          <Button
            text="Save Clone Root"
            intent="primary"
            onClick={handleSaveCloneRoot}
            disabled={cloneRoot === initialCloneRoot}
            className={styles.saveButton}
          />
        </Card>

        <div className={styles.header}>
          <H3 className={styles.title}>Danger zone</H3>
        </div>

        <Card>
          <p>
            Resetting to factory settings will erase the current configuration
            and replace it with the default configuration, as provided to new
            users. It does <i>not</i> affect connections and stars.
          </p>
          <Button
            text="Reset to factory settings"
            intent="danger"
            outlined
            onClick={() => setResetting(true)}
          />
        </Card>
      </div>
      <ConfirmDialog
        isOpen={isResetting}
        onClose={() => setResetting(false)}
        onSubmit={handleReset}
      >
        Are you sure you want to reset configuration to factory settings?
      </ConfirmDialog>
    </>
  );
}
