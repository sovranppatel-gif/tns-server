import {
  createBackup,
  deleteBackup,
  downloadBackupFile,
  getBackupStatus,
  listBackups,
  restoreBackup,
} from "./backup.service.js";

function actorFromReq(req) {
  return req.masterAdmin?.name || req.masterAdmin?.email || "master-admin";
}

function fail(res, err) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error("backup error:", err);
  return res.status(status).json({
    success: false,
    message: err.message || "Backup request failed",
  });
}

export async function getBackupStatusController(_req, res) {
  try {
    const data = await getBackupStatus();
    return res.json({
      success: true,
      message: "Backup status loaded",
      ...data,
    });
  } catch (err) {
    return fail(res, err);
  }
}

export async function listBackupsController(_req, res) {
  try {
    const backups = await listBackups();
    return res.json({
      success: true,
      message: "Backups loaded",
      backups,
    });
  } catch (err) {
    return fail(res, err);
  }
}

export async function createBackupController(req, res) {
  try {
    const scope = String(req.body?.scope || req.query.scope || "all").toLowerCase();
    const backup = await createBackup({ scope, actor: actorFromReq(req) });
    return res.status(201).json({
      success: true,
      message: `Backup ${backup.backupId} is ready`,
      backup,
    });
  } catch (err) {
    return fail(res, err);
  }
}

export async function downloadBackupController(req, res) {
  try {
    const file = await downloadBackupFile(req.params.id);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.download(file.filepath, file.filename);
  } catch (err) {
    return fail(res, err);
  }
}

export async function deleteBackupController(req, res) {
  try {
    const result = await deleteBackup(req.params.id, actorFromReq(req));
    return res.json({
      success: true,
      message: `Deleted backup ${result.backupId}`,
      ...result,
    });
  } catch (err) {
    return fail(res, err);
  }
}

export async function restoreBackupController(req, res) {
  try {
    const result = await restoreBackup(req.params.id, {
      confirm: req.body?.confirm,
      includeUsers: Boolean(req.body?.includeUsers),
      actor: actorFromReq(req),
    });
    return res.json({
      success: true,
      message: `Restored ${result.documentCount} documents from ${result.backupId}`,
      ...result,
    });
  } catch (err) {
    return fail(res, err);
  }
}
