/**
 * Tool executors — her tool için real-world action.
 *
 * Hepsi async, dönen değer model'e geri verilecek string (success/error/data).
 * VS Code API kullanır: workspace.fs, vscode.Terminal, vscode.window.
 */
const vscode = require("vscode");
const path = require("path");

const MAX_READ_BYTES = 100_000; // 100 KB read cap
const COMMAND_TIMEOUT_MS = 60_000;

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function resolveUri(relPath) {
  const root = workspaceRoot();
  if (!root) throw new Error("No workspace folder open");
  return vscode.Uri.joinPath(root, relPath);
}

/** READ_FILE */
async function read_file({ path: relPath }) {
  if (!relPath) return { ok: false, error: "path parametresi eksik" };
  try {
    const uri = resolveUri(relPath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    let text = Buffer.from(bytes).toString("utf8");
    if (text.length > MAX_READ_BYTES) {
      text = text.slice(0, MAX_READ_BYTES) + `\n\n... [truncated, file > ${MAX_READ_BYTES} chars]`;
    }
    return { ok: true, data: text, lineCount: text.split("\n").length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** WRITE_TO_FILE */
async function write_to_file({ path: relPath, content }) {
  if (!relPath) return { ok: false, error: "path parametresi eksik" };
  if (content === undefined || content === null) return { ok: false, error: "content parametresi eksik" };
  try {
    const uri = resolveUri(relPath);
    // Ensure parent dir exists
    const dir = vscode.Uri.joinPath(uri, "..");
    try {
      await vscode.workspace.fs.createDirectory(dir);
    } catch (_e) {}
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
    // Open + show diff-friendly (close, reopen to refresh)
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    return { ok: true, data: `${content.length} chars written to ${relPath}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** EXECUTE_COMMAND — terminal'de çalıştır, çıktıyı 60 saniye dinle */
async function execute_command({ command }) {
  if (!command) return { ok: false, error: "command parametresi eksik" };
  return new Promise((resolve) => {
    const root = workspaceRoot();
    if (!root) {
      resolve({ ok: false, error: "Workspace yok" });
      return;
    }
    // VS Code Terminal API: chunk listener yok built-in, biz `child_process` ile kapalı çalıştırırız
    const { exec } = require("child_process");
    const opts = {
      cwd: root.fsPath,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      shell: process.platform === "win32" ? "powershell.exe" : "/bin/bash",
      windowsHide: true,
    };
    exec(command, opts, (err, stdout, stderr) => {
      const truncate = (s) => (s.length > 5000 ? s.slice(0, 5000) + "\n... [truncated]" : s);
      if (err) {
        resolve({
          ok: false,
          error: err.message,
          stdout: truncate(stdout || ""),
          stderr: truncate(stderr || ""),
          code: err.code,
        });
        return;
      }
      resolve({
        ok: true,
        data: truncate((stdout || "") + (stderr ? "\n[stderr]\n" + truncate(stderr) : "")),
      });
    });
  });
}

/** LIST_FILES — dizin içeriği */
async function list_files({ path: relPath = ".", recursive = "false" }) {
  try {
    const uri = relPath === "." ? workspaceRoot() : resolveUri(relPath);
    if (!uri) return { ok: false, error: "Workspace yok" };
    const isRecursive = String(recursive).toLowerCase() === "true";
    const lines = [];
    async function walk(u, depth = 0) {
      if (depth > 5) return;
      const entries = await vscode.workspace.fs.readDirectory(u);
      for (const [name, type] of entries) {
        if (name.startsWith(".") && name !== ".gitignore") continue; // skip hidden
        if (name === "node_modules") continue;
        const prefix = "  ".repeat(depth);
        const suffix = type === 2 ? "/" : ""; // FileType.Directory = 2
        lines.push(`${prefix}${name}${suffix}`);
        if (isRecursive && type === 2 && lines.length < 200) {
          await walk(vscode.Uri.joinPath(u, name), depth + 1);
        }
      }
    }
    await walk(uri);
    return { ok: true, data: lines.join("\n") || "(empty)" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** ASK_FOLLOWUP_QUESTION — model kullanıcıya soru sormak istiyor */
async function ask_followup_question({ question }) {
  if (!question) return { ok: false, error: "question parametresi eksik" };
  const answer = await vscode.window.showInputBox({
    prompt: question,
    placeHolder: "Cevabını yaz...",
    ignoreFocusOut: true,
  });
  if (answer === undefined) return { ok: false, error: "Kullanıcı iptal etti" };
  return { ok: true, data: answer };
}

/** ATTEMPT_COMPLETION — model "tamam görev bitti" diyor, loop kırılır */
async function attempt_completion({ result }) {
  return { ok: true, data: result || "Görev tamamlandı.", terminal: true };
}

const EXECUTORS = {
  read_file,
  write_to_file,
  execute_command,
  list_files,
  ask_followup_question,
  attempt_completion,
};

module.exports = { EXECUTORS };
