/**
 * File-name sanitation for downloads saved without a native save dialog.
 *
 * The Bulk tab and no-dialog single downloads write archives straight into
 * their target folders, so names derived from model titles must be safe for
 * the Windows file system before the final file is written.
 *
 * Single downloads in "before"/"after" modes keep using the native "Save as"
 * dialog and are deliberately not routed through this helper.
 */
"use strict";

/** Characters Windows forbids in a file name (plus control characters). */
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;
/** Windows silently drops trailing dots and spaces. */
const TRAILING_DOTS_SPACES = /[. ]+$/;
/** Device names reserved by Windows, matched case-insensitively. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Remove Windows-invalid characters from an automatically saved archive name.
 *
 * Valid names are returned byte-for-byte unchanged. When cleaning removes
 * characters, runs of spaces left behind are collapsed once and trailing
 * dots/spaces are trimmed. A name that becomes empty falls back to
 * `model_<uid>` (or plain `model` when the UID is unavailable).
 *
 * @param {string} name generated archive name, e.g. "Model: Ruins-1a2b3c4d.zip"
 * @param {string} [uid] model UID used for the empty-name fallback
 * @returns {string} a name that can be written on Windows
 */
function sanitizeBulkFileName(name, uid) {
  const source = String(name == null ? "" : name);
  let cleaned = source.replace(INVALID_CHARS, "");

  if (cleaned !== source) {
    // Only touch spacing when forbidden characters were actually removed, so
    // names that were already valid keep their original internal spacing.
    cleaned = cleaned.replace(/ {2,}/g, " ");
  }
  cleaned = cleaned.replace(TRAILING_DOTS_SPACES, "");

  if (!cleaned) {
    const id = String(uid == null ? "" : uid).trim();
    cleaned = id ? `model_${id}` : "model";
  }

  // Windows reserves device names regardless of extension ("con.zip"), and
  // treats the part before the first dot as the device name.
  const dot = cleaned.indexOf(".");
  const stem = (dot === -1 ? cleaned : cleaned.slice(0, dot)).replace(
    TRAILING_DOTS_SPACES,
    "",
  );
  if (RESERVED_NAME.test(stem)) cleaned = `_${cleaned}`;

  return cleaned;
}

module.exports = { sanitizeBulkFileName };
