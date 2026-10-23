import { readFile } from "fs/promises";
import { contentTypeForDocumentType } from "./documentTypes";
import { MX_CIVIL_COMMERCIAL_SYNC_ENTRY } from "./recovery/workflows/mxCivilCommercialPlaybook";
import { storageEnabled, uploadFile } from "./storage";
import {
  prepareWorkflowCatalog,
  removePreparedWorkflowCatalog,
  validateWorkflowCatalogDocument,
  type WorkflowCatalogSourceOptions,
  type WorkflowCatalogSourceWorkflow,
} from "./workflowCatalogSource";
import type { Db } from "./supabase";

export type WorkflowCatalogSyncResult = {
  workflows: number;
  assets: number;
  /** Upstream import commit; owned entries retain their own source commits. */
  sourceCommit: string;
};

function metadataWithoutTemporaryAssets(
  workflow: WorkflowCatalogSourceWorkflow,
  assets: Array<{
    filename: string;
    file_type: string;
    storage_path: string;
    size_bytes: number;
    content_hash: string;
  }>,
) {
  const { assets: _assets, ...metadata } = workflow;
  return { ...metadata, assets };
}

/**
 * The import's provenance for every upstream entry: where the catalog content
 * came from and what review it has passed. `mike_workflows` is the only
 * seeded catalog, so each row states its own source instead of relying on the
 * batch commit alone, and LiTT-audience content is never presented as legally
 * validated when it is not.
 */
function upstreamProvenance(document: {
  source_repository: string;
  source_commit: string;
}) {
  return {
    source: `https://github.com/${document.source_repository}/tree/${document.source_commit}`,
    approval_provenance: "Upstream catalog import; LiTT legal validation pending",
  };
}

export async function syncWorkflowCatalog(
  db: Db,
  options: WorkflowCatalogSourceOptions = {},
): Promise<WorkflowCatalogSyncResult> {
  const prepared = await prepareWorkflowCatalog(options);
  try {
    const document = validateWorkflowCatalogDocument(
      JSON.parse(await readFile(prepared.catalogPath, "utf8")) as unknown,
    );
    // The MX playbook is owned content with its own source commit. A catalog
    // that also declares its key would be replaced by the seed on every sync,
    // so the collision fails instead of silently changing which content wins.
    if (
      document.workflows.some(
        (workflow) =>
          workflow.workflow_key === MX_CIVIL_COMMERCIAL_SYNC_ENTRY.workflow_key,
      )
    ) {
      throw new Error(
        `Upstream catalog collides with reserved workflow key '${MX_CIVIL_COMMERCIAL_SYNC_ENTRY.workflow_key}'`,
      );
    }
    let assetCount = 0;
    const databaseWorkflows = [];
    const hasAssets = document.workflows.some(
      (workflow) => workflow.assets.length > 0,
    );
    if (hasAssets && !storageEnabled) {
      throw new Error(
        "Workflow assets require configured S3-compatible storage",
      );
    }

    for (const workflow of document.workflows) {
      const databaseAssets = [];
      for (const asset of workflow.assets) {
        if (storageEnabled) {
          const storagePath =
            `mike-workflows/${workflow.workflow_key}/` +
            `${asset.content_hash}/${asset.filename}`;
          const bytes = await readFile(asset.temporary_path);
          await uploadFile(
            storagePath,
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer,
            contentTypeForDocumentType(asset.file_type),
          );
          databaseAssets.push({
            filename: asset.filename,
            file_type: asset.file_type,
            storage_path: storagePath,
            size_bytes: asset.size_bytes,
            content_hash: asset.content_hash,
          });
          assetCount += 1;
        }
      }
      databaseWorkflows.push({
        ...metadataWithoutTemporaryAssets(workflow, databaseAssets),
        ...upstreamProvenance(document),
      });
    }
    databaseWorkflows.push(MX_CIVIL_COMMERCIAL_SYNC_ENTRY);

    const { error } = await db.rpc("replace_mike_workflows", {
      p_source_commit: document.source_commit,
      p_workflows: databaseWorkflows,
    });
    if (error) throw error;

    return {
      workflows: databaseWorkflows.length,
      assets: assetCount,
      sourceCommit: document.source_commit,
    };
  } finally {
    await removePreparedWorkflowCatalog(prepared);
  }
}
