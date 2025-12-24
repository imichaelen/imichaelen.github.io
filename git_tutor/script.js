/* eslint-disable no-console */
/*
  Git Tutor — a single-page, no-build, vanilla JS interactive Git tutorial.

  Design goals:
  - Everything runs locally in the browser (no network calls).
  - The "terminal" validates commands and mutates a simulated repository model.
  - UI panels (files + git graph + lesson steps) update live from that model.
*/

(() => {
  "use strict";

  // -----------------------------
  // Small DOM / formatting helpers
  // -----------------------------

  const qs = (selector, root = document) => root.querySelector(selector);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function deepCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function nowMs() {
    return Date.now();
  }

  function shortHash(hash) {
    if (!hash) return "—";
    return String(hash).slice(0, 7);
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  // -----------------------------
  // Path utilities for the fake FS
  // -----------------------------

  function normalizePath(inputPath) {
    const raw = String(inputPath || "").replaceAll("\\", "/");
    const absolute = raw.startsWith("/");
    const parts = raw.split("/").filter(Boolean);
    const stack = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") {
        stack.pop();
        continue;
      }
      stack.push(part);
    }
    return (absolute ? "/" : "/") + stack.join("/");
  }

  function joinPath(cwd, maybeRelative) {
    const rel = String(maybeRelative || "");
    if (rel.startsWith("/")) return normalizePath(rel);
    const base = String(cwd || "/");
    const combined = base.endsWith("/") ? base + rel : `${base}/${rel}`;
    return normalizePath(combined);
  }

  function dirname(path) {
    const p = normalizePath(path);
    if (p === "/") return "/";
    const parts = p.split("/").filter(Boolean);
    parts.pop();
    return "/" + parts.join("/");
  }

  function basename(path) {
    const p = normalizePath(path);
    if (p === "/") return "/";
    const parts = p.split("/").filter(Boolean);
    return parts[parts.length - 1] || "/";
  }

  // -----------------------------
  // Command-line parsing (minimal)
  // -----------------------------

  // Splits a command line into tokens. Supports basic "double quotes".
  function splitArgs(line) {
    const input = String(line || "").trim();
    if (!input) return [];

    const tokens = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && /\s/.test(ch)) {
        if (current.length) tokens.push(current);
        current = "";
        continue;
      }
      current += ch;
    }
    if (current.length) tokens.push(current);
    return tokens;
  }

  // Parses `echo "text" > file` (and a couple of simple variants).
  function parseEchoRedirection(line) {
    const trimmed = String(line || "").trim();
    if (!trimmed.startsWith("echo ")) return null;
    const idx = trimmed.indexOf(">");
    if (idx === -1) return null;

    const left = trimmed.slice(0, idx).trim();
    const right = trimmed.slice(idx + 1).trim();
    const fileArg = right.replace(/^"+|"+$/g, "");

    const leftTokens = splitArgs(left);
    // leftTokens[0] === "echo"
    const text = leftTokens.slice(1).join(" ");
    return { text, fileArg };
  }

  // -----------------------------
  // Command database (help + autocomplete)
  // -----------------------------

  const COMMAND_DB = [
    { cmd: "git init", group: "Basics", desc: "Initialize a new repository." },
    { cmd: "git status", group: "Basics", desc: "Show staged/unstaged changes." },
    { cmd: "git add <file>|.", group: "Basics", desc: "Stage changes for commit." },
    { cmd: 'git commit -m "message"', group: "Basics", desc: "Create a commit from staged changes." },
    { cmd: "git log [--oneline]", group: "Basics", desc: "Show commit history." },
    { cmd: "git branch [name]", group: "Branching", desc: "List or create branches." },
    { cmd: "git checkout <branch>", group: "Branching", desc: "Switch branches." },
    { cmd: "git checkout -b <branch>", group: "Branching", desc: "Create and switch branches." },
    { cmd: "git merge <branch>", group: "Merging", desc: "Merge another branch into the current one." },
    { cmd: "git remote", group: "Remote", desc: "List remotes." },
    { cmd: "git remote -v", group: "Remote", desc: "List remotes with URLs." },
    { cmd: "git remote add <name> <url>", group: "Remote", desc: "Add a remote (simulated)." },
    { cmd: "git push [-u] <remote> <branch>", group: "Remote", desc: "Push commits to a remote (simulated)." },
    { cmd: "git pull [<remote> <branch>]", group: "Remote", desc: "Pull commits from a remote (simulated)." },
    { cmd: "git clone <url>", group: "Remote", desc: "Clone a remote repository (simulated)." },
    { cmd: "git stash", group: "Advanced", desc: "Temporarily save uncommitted work." },
    { cmd: "git stash pop", group: "Advanced", desc: "Re-apply the last stash." },
    { cmd: "git reset --hard [<hash>|HEAD~1]", group: "Advanced", desc: "Discard changes and move HEAD." },
    { cmd: "git revert <hash>", group: "Advanced", desc: "Create a new commit that undoes another." },
    { cmd: "ls", group: "Shell", desc: "List files in the current directory (simulated)." },
    { cmd: "pwd", group: "Shell", desc: "Print working directory (simulated)." },
    { cmd: "cd <dir>", group: "Shell", desc: "Change directory (simulated)." },
    { cmd: "mkdir <dir>", group: "Shell", desc: "Create a directory (simulated)." },
    { cmd: "touch <file>", group: "Shell", desc: "Create an empty file (simulated)." },
    { cmd: 'echo "text" > <file>', group: "Shell", desc: "Write text to a file (simulated)." },
    { cmd: "cat <file>", group: "Shell", desc: "Print a file (simulated)." },
    { cmd: "edit <file>", group: "Shell", desc: "Open the in-app file editor." },
    { cmd: "clear", group: "Shell", desc: "Clear the terminal output." },
    { cmd: "help", group: "Shell", desc: "Show quick usage tips." },
  ];

  const BRANCH_COLORS = ["#4cc9f0", "#b392f0", "#2ee59d", "#ffd166", "#ff5470", "#ff9f1c"];

  // -----------------------------
  // Remote store (simulated "servers")
  // -----------------------------

  class RemoteStore {
    constructor() {
      this.byUrl = {};
    }

    ensureRepo(url) {
      const normalized = String(url || "").trim();
      if (!normalized) throw new Error("Remote URL is required.");
      if (!this.byUrl[normalized]) {
        this.byUrl[normalized] = RemoteStore.createEmptyRemote(normalized);
      }
      return this.byUrl[normalized];
    }

    getRepo(url) {
      const normalized = String(url || "").trim();
      return this.byUrl[normalized] || null;
    }

    static createEmptyRemote(url) {
      return {
        url,
        commits: {},
        commitOrder: [],
        branches: { main: null },
      };
    }

    serialize() {
      return deepCopy({ byUrl: this.byUrl });
    }

    static deserialize(obj) {
      const store = new RemoteStore();
      const safe = obj && typeof obj === "object" ? obj : {};
      store.byUrl = safe.byUrl && typeof safe.byUrl === "object" ? safe.byUrl : {};
      return store;
    }
  }

  // -----------------------------
  // Simulated Git repository model
  // -----------------------------

  class SimulatedRepo {
    constructor() {
      this.reset();
    }

    reset() {
      this.initialized = false;
      this.cwd = "/";
      this.directories = { "/": true };
      this.workingFiles = {};
      this.stagedFiles = {};
      this.commits = {};
      this.commitOrder = [];
      this.branches = { main: null };
      this.currentBranch = "main";
      this.branchMeta = {
        main: { lane: 0, color: BRANCH_COLORS[0] },
      };
      this.nextLane = 1;
      this.mergeState = null; // {theirBranch, theirHash, conflicts: string[]}
      this.remotes = {}; // name -> {url}
      this.upstreams = {}; // branch -> {remote, branch}
      this.stash = []; // {message, workingFiles, stagedFiles, createdAt}
      this.lastEvent = null; // for badge triggers
    }

    serialize() {
      return deepCopy({
        initialized: this.initialized,
        cwd: this.cwd,
        directories: this.directories,
        workingFiles: this.workingFiles,
        stagedFiles: this.stagedFiles,
        commits: this.commits,
        commitOrder: this.commitOrder,
        branches: this.branches,
        currentBranch: this.currentBranch,
        branchMeta: this.branchMeta,
        nextLane: this.nextLane,
        mergeState: this.mergeState,
        remotes: this.remotes,
        upstreams: this.upstreams,
        stash: this.stash,
      });
    }

    static deserialize(obj) {
      const safe = obj && typeof obj === "object" ? obj : {};
      const repo = new SimulatedRepo();
      repo.initialized = !!safe.initialized;
      repo.cwd = typeof safe.cwd === "string" ? safe.cwd : "/";
      repo.directories = safe.directories && typeof safe.directories === "object" ? safe.directories : { "/": true };
      repo.workingFiles = safe.workingFiles && typeof safe.workingFiles === "object" ? safe.workingFiles : {};
      repo.stagedFiles = safe.stagedFiles && typeof safe.stagedFiles === "object" ? safe.stagedFiles : {};
      repo.commits = safe.commits && typeof safe.commits === "object" ? safe.commits : {};
      repo.commitOrder = Array.isArray(safe.commitOrder) ? safe.commitOrder : [];
      repo.branches = safe.branches && typeof safe.branches === "object" ? safe.branches : { main: null };
      repo.currentBranch = typeof safe.currentBranch === "string" ? safe.currentBranch : "main";
      repo.branchMeta = safe.branchMeta && typeof safe.branchMeta === "object" ? safe.branchMeta : {};
      repo.nextLane = typeof safe.nextLane === "number" ? safe.nextLane : 1;
      repo.mergeState = safe.mergeState && typeof safe.mergeState === "object" ? safe.mergeState : null;
      repo.remotes = safe.remotes && typeof safe.remotes === "object" ? safe.remotes : {};
      repo.upstreams = safe.upstreams && typeof safe.upstreams === "object" ? safe.upstreams : {};
      repo.stash = Array.isArray(safe.stash) ? safe.stash : [];

      // Ensure required defaults exist even if loaded from older state.
      if (!repo.branches.main) repo.branches.main = repo.branches.main ?? null;
      if (!repo.branchMeta.main) repo.branchMeta.main = { lane: 0, color: BRANCH_COLORS[0] };
      if (!repo.directories["/"]) repo.directories["/"] = true;
      if (!repo.branches[repo.currentBranch]) repo.currentBranch = Object.keys(repo.branches)[0] || "main";
      return repo;
    }

    get head() {
      return this.branches[this.currentBranch] ?? null;
    }

    set head(hash) {
      this.branches[this.currentBranch] = hash;
    }

    getHeadSnapshot() {
      const hash = this.head;
      if (!hash) return {};
      const commit = this.commits[hash];
      return commit ? commit.files : {};
    }

    getSnapshot(hash) {
      if (!hash) return {};
      const commit = this.commits[hash];
      return commit ? commit.files : {};
    }

    listAllPaths() {
      const headSnap = this.getHeadSnapshot();
      const paths = new Set([...Object.keys(this.workingFiles), ...Object.keys(headSnap), ...Object.keys(this.stagedFiles)]);
      return Array.from(paths).sort();
    }

    // Returns a high-level status for UI rendering.
    getStatus() {
      const headSnap = this.getHeadSnapshot();
      const staged = [];
      const unstaged = [];
      const untracked = [];
      const conflicts = this.mergeState?.conflicts ? new Set(this.mergeState.conflicts) : new Set();

      const stagedMap = this.stagedFiles;
      const allPaths = this.listAllPaths();

      for (const path of allPaths) {
        const headHas = Object.prototype.hasOwnProperty.call(headSnap, path);
        const workHas = Object.prototype.hasOwnProperty.call(this.workingFiles, path);
        const stageHas = Object.prototype.hasOwnProperty.call(stagedMap, path);

        const headContent = headHas ? headSnap[path] : undefined;
        const workContent = workHas ? this.workingFiles[path] : undefined;
        const stagedContent = stageHas ? stagedMap[path] : undefined; // string or null

        const isConflict = conflicts.has(path);
        if (isConflict) {
          // Conflicts are shown as their own category, but we still allow staging to resolve.
          continue;
        }

        // Staged differences (index vs HEAD)
        if (stageHas) {
          const stagedIsDelete = stagedContent === null;
          const indexContent = stagedIsDelete ? undefined : stagedContent;

          if (!headHas && indexContent !== undefined) staged.push({ path, code: "A" });
          else if (headHas && indexContent === undefined) staged.push({ path, code: "D" });
          else if (headHas && indexContent !== headContent) staged.push({ path, code: "M" });
        }

        // Working differences (working tree vs index/HEAD)
        const indexBaseline = stageHas ? (stagedContent === null ? undefined : stagedContent) : headContent;

        const isUntracked = !headHas && workHas;
        if (isUntracked) {
          untracked.push({ path, code: "A" });
          continue;
        }

        const isDeleted = headHas && !workHas;
        if (isDeleted) {
          // Deleted files may be staged or unstaged; if not staged, they show as unstaged deletion.
          if (!stageHas) unstaged.push({ path, code: "D" });
          continue;
        }

        const isModified = headHas && workHas && workContent !== headContent;
        if (isModified) {
          // If index already matches working, it's not unstaged.
          if (workContent !== indexBaseline) unstaged.push({ path, code: "M" });
        }
      }

      return {
        branch: this.currentBranch,
        initialized: this.initialized,
        hasCommits: this.commitOrder.length > 0,
        staged,
        unstaged,
        untracked,
        mergeState: this.mergeState,
        conflicts: this.mergeState?.conflicts ? [...this.mergeState.conflicts] : [],
        isDirty:
          Object.keys(this.stagedFiles).length > 0 ||
          staged.length > 0 ||
          unstaged.length > 0 ||
          untracked.length > 0 ||
          (this.mergeState && (this.mergeState.conflicts?.length || 0) > 0),
      };
    }

    // A commit's "lane" is used only for drawing the graph (it's not Git behavior).
    ensureBranchMeta(branchName) {
      if (this.branchMeta[branchName]) return;
      const lane = this.nextLane;
      const color = BRANCH_COLORS[lane % BRANCH_COLORS.length];
      this.branchMeta[branchName] = { lane, color };
      this.nextLane += 1;
    }

    genHash() {
      // Short, Git-ish looking hash.
      const alphabet = "0123456789abcdef";
      let out = "";
      for (let i = 0; i < 12; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
      return out;
    }

    isAncestor(ancestorHash, descendantHash) {
      if (!ancestorHash || !descendantHash) return false;
      if (ancestorHash === descendantHash) return true;
      const seen = new Set();
      const stack = [descendantHash];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || seen.has(cur)) continue;
        seen.add(cur);
        if (cur === ancestorHash) return true;
        const commit = this.commits[cur];
        if (!commit) continue;
        for (const parent of commit.parents || []) stack.push(parent);
      }
      return false;
    }

    findCommonAncestor(a, b) {
      if (!a || !b) return null;
      if (a === b) return a;
      const dist = new Map();
      const queue = [{ hash: a, d: 0 }];
      while (queue.length) {
        const { hash, d } = queue.shift();
        if (!hash || dist.has(hash)) continue;
        dist.set(hash, d);
        const commit = this.commits[hash];
        if (!commit) continue;
        for (const parent of commit.parents || []) queue.push({ hash: parent, d: d + 1 });
      }

      let best = null;
      let bestD = Infinity;
      const queue2 = [{ hash: b, d: 0 }];
      const seen2 = new Set();
      while (queue2.length) {
        const { hash, d } = queue2.shift();
        if (!hash || seen2.has(hash)) continue;
        seen2.add(hash);
        if (dist.has(hash)) {
          const total = dist.get(hash) + d;
          if (total < bestD) {
            bestD = total;
            best = hash;
          }
        }
        const commit = this.commits[hash];
        if (!commit) continue;
        for (const parent of commit.parents || []) queue2.push({ hash: parent, d: d + 1 });
      }
      return best;
    }

    ensureInitialized() {
      if (!this.initialized) {
        return { ok: false, exitCode: 1, stderr: ["fatal: not a git repository (simulated)"] };
      }
      return { ok: true };
    }

    // -----------------------------
    // Shell-ish commands (simulated)
    // -----------------------------

    runShell(line) {
      const echoParsed = parseEchoRedirection(line);
      if (echoParsed) {
        const path = joinPath(this.cwd, echoParsed.fileArg);
        this.directories[dirname(path)] = true;
        this.workingFiles[path] = echoParsed.text.replaceAll("\\n", "\n");
        this.lastEvent = { type: "fs_write", path };
        return { ok: true, exitCode: 0, stdout: [], stderr: [] };
      }

      const args = splitArgs(line);
      const cmd = args[0];
      if (!cmd) return { ok: true, exitCode: 0, stdout: [], stderr: [] };

      if (cmd === "pwd") {
        return { ok: true, exitCode: 0, stdout: [this.cwd], stderr: [] };
      }

      if (cmd === "ls") {
        const target = args[1] ? joinPath(this.cwd, args[1]) : this.cwd;
        const list = this.listDir(target);
        return { ok: true, exitCode: 0, stdout: [list.join("  ") || ""], stderr: [] };
      }

      if (cmd === "cd") {
        const next = args[1] ? joinPath(this.cwd, args[1]) : "/";
        // Validate: allow cd into any known directory, or into one that contains files.
        if (!this.isDirectory(next)) {
          return { ok: false, exitCode: 1, stderr: [`cd: no such directory: ${next}`], stdout: [] };
        }
        this.cwd = next;
        return { ok: true, exitCode: 0, stdout: [], stderr: [] };
      }

      if (cmd === "mkdir") {
        const name = args[1];
        if (!name) return { ok: false, exitCode: 1, stderr: ["mkdir: missing operand"], stdout: [] };
        const path = joinPath(this.cwd, name);
        this.directories[path] = true;
        this.lastEvent = { type: "fs_mkdir", path };
        return { ok: true, exitCode: 0, stdout: [], stderr: [] };
      }

      if (cmd === "touch") {
        const name = args[1];
        if (!name) return { ok: false, exitCode: 1, stderr: ["touch: missing file operand"], stdout: [] };
        const path = joinPath(this.cwd, name);
        this.directories[dirname(path)] = true;
        if (!Object.prototype.hasOwnProperty.call(this.workingFiles, path)) this.workingFiles[path] = "";
        this.lastEvent = { type: "fs_touch", path };
        return { ok: true, exitCode: 0, stdout: [], stderr: [] };
      }

      if (cmd === "rm") {
        const name = args[1];
        if (!name) return { ok: false, exitCode: 1, stderr: ["rm: missing file operand"], stdout: [] };
        const path = joinPath(this.cwd, name);
        if (!Object.prototype.hasOwnProperty.call(this.workingFiles, path)) {
          return { ok: false, exitCode: 1, stderr: [`rm: cannot remove '${name}': No such file`], stdout: [] };
        }
        delete this.workingFiles[path];
        this.lastEvent = { type: "fs_rm", path };
        return { ok: true, exitCode: 0, stdout: [], stderr: [] };
      }

      if (cmd === "cat") {
        const name = args[1];
        if (!name) return { ok: false, exitCode: 1, stderr: ["cat: missing file operand"], stdout: [] };
        const path = joinPath(this.cwd, name);
        if (!Object.prototype.hasOwnProperty.call(this.workingFiles, path)) {
          return { ok: false, exitCode: 1, stderr: [`cat: ${name}: No such file`], stdout: [] };
        }
        return { ok: true, exitCode: 0, stdout: [this.workingFiles[path]], stderr: [] };
      }

      return { ok: false, exitCode: 127, stdout: [], stderr: [`command not found: ${cmd}`] };
    }

    listDir(path) {
      const dir = normalizePath(path);
      const outDirs = new Set();
      const outFiles = new Set();

      for (const d of Object.keys(this.directories)) {
        if (d !== dir && dirname(d) === dir) outDirs.add(basename(d) + "/");
      }
      for (const filePath of Object.keys(this.workingFiles)) {
        const parent = dirname(filePath);
        if (parent === dir) outFiles.add(basename(filePath));
        if (parent.startsWith(dir) && parent !== dir) {
          // Surface a directory name when files exist under it.
          const rel = parent.slice(dir === "/" ? 1 : dir.length + 1);
          const top = rel.split("/")[0];
          if (top) outDirs.add(top + "/");
        }
      }

      return [...outDirs].sort().concat([...outFiles].sort());
    }

    isDirectory(path) {
      const dir = normalizePath(path);
      if (this.directories[dir]) return true;
      // Implicit directories created by files.
      const prefix = dir === "/" ? "/" : dir + "/";
      for (const filePath of Object.keys(this.workingFiles)) {
        if (filePath.startsWith(prefix)) return true;
      }
      return false;
    }

    // -----------------------------
    // Git commands (simulated)
    // -----------------------------

    runGit(line, ctx) {
      const args = splitArgs(line);
      const sub = args[1];

      if (!sub) {
        return {
          ok: false,
          exitCode: 1,
          stdout: [],
          stderr: ["usage: git <command> [<args>]", "Try: git init, git status, git add, git commit, git log"],
        };
      }

      if (sub === "init") return this.gitInit();
      if (sub === "status") return this.gitStatus();
      if (sub === "add") return this.gitAdd(args.slice(2));
      if (sub === "commit") return this.gitCommit(args.slice(2));
      if (sub === "log") return this.gitLog(args.slice(2));
      if (sub === "branch") return this.gitBranch(args.slice(2));
      if (sub === "checkout") return this.gitCheckout(args.slice(2));
      if (sub === "merge") return this.gitMerge(args.slice(2));
      if (sub === "remote") return this.gitRemote(args.slice(2), ctx);
      if (sub === "push") return this.gitPush(args.slice(2), ctx);
      if (sub === "pull") return this.gitPull(args.slice(2), ctx);
      if (sub === "clone") return this.gitClone(args.slice(2), ctx);
      if (sub === "stash") return this.gitStash(args.slice(2));
      if (sub === "reset") return this.gitReset(args.slice(2));
      if (sub === "revert") return this.gitRevert(args.slice(2));

      return { ok: false, exitCode: 1, stdout: [], stderr: [`git: '${sub}' is not implemented in this tutorial.`] };
    }

    gitInit() {
      const already = this.initialized;
      this.initialized = true;
      if (!this.branches.main) this.branches.main = this.branches.main ?? null;
      if (!this.currentBranch) this.currentBranch = "main";
      this.lastEvent = { type: "git_init" };
      return {
        ok: true,
        exitCode: 0,
        stdout: [
          already
            ? "Reinitialized existing Git repository (simulated)."
            : "Initialized empty Git repository (simulated).",
        ],
        stderr: [],
      };
    }

    gitStatus() {
      const init = this.ensureInitialized();
      if (!init.ok) return init;

      const status = this.getStatus();
      const out = [];

      out.push(`On branch ${status.branch}`);
      if (!status.hasCommits) out.push("No commits yet");

      if (status.mergeState) {
        out.push("");
        out.push("You are in the middle of a merge.");
        if (status.conflicts.length) {
          out.push("  (fix conflicts and run \"git add <file>\" then \"git commit\")");
        } else {
          out.push("  (all conflicts fixed: run \"git commit\" to conclude merge)");
        }
      }

      const section = (title, lines) => {
        if (!lines.length) return;
        out.push("");
        out.push(title);
        for (const line of lines) out.push(`  ${line}`);
      };

      const stagedLines = status.staged.map((f) => `${this.statusLabel(f.code)}:   ${this.relPath(f.path)}`);
      section("Changes to be committed:", stagedLines);

      const unstagedLines = status.unstaged.map((f) => `${this.statusLabel(f.code)}:   ${this.relPath(f.path)}`);
      section("Changes not staged for commit:", unstagedLines);

      const untrackedLines = status.untracked.map((f) => `${this.relPath(f.path)}`);
      section("Untracked files:", untrackedLines);

      if (!status.staged.length && !status.unstaged.length && !status.untracked.length && !status.conflicts.length) {
        out.push("");
        out.push("nothing to commit, working tree clean");
      }

      if (status.conflicts.length) {
        out.push("");
        out.push("Unmerged paths:");
        for (const p of status.conflicts) out.push(`  both modified: ${this.relPath(p)}`);
      }

      return { ok: true, exitCode: 0, stdout: out, stderr: [] };
    }

    statusLabel(code) {
      if (code === "A") return "new file";
      if (code === "M") return "modified";
      if (code === "D") return "deleted";
      return "changed";
    }

    relPath(absPath) {
      const p = normalizePath(absPath);
      if (p === "/") return "/";
      return p.startsWith("/") ? p.slice(1) : p;
    }

    gitAdd(args) {
      const init = this.ensureInitialized();
      if (!init.ok) return init;

      if (!args.length) return { ok: false, exitCode: 1, stdout: [], stderr: ["fatal: pathspec is required"] };

      const targets = [];
      if (args.includes(".") || args.includes("-A") || args.includes("--all")) {
        // Stage everything (including deletions).
        const all = new Set([...Object.keys(this.workingFiles), ...Object.keys(this.getHeadSnapshot())]);
        targets.push(...Array.from(all));
      } else {
        for (const a of args) targets.push(joinPath(this.cwd, a));
      }

      const headSnap = this.getHeadSnapshot();
      const conflicts = this.mergeState?.conflicts ? new Set(this.mergeState.conflicts) : new Set();

      const added = [];
      const errors = [];

      for (const path of targets) {
        const workHas = Object.prototype.hasOwnProperty.call(this.workingFiles, path);
        const headHas = Object.prototype.hasOwnProperty.call(headSnap, path);

        if (workHas) {
          this.stagedFiles[path] = this.workingFiles[path];
          added.push(path);
          if (conflicts.has(path)) conflicts.delete(path);
          continue;
        }

        if (!workHas && headHas) {
          this.stagedFiles[path] = null; // deletion
          added.push(path);
          continue;
        }

        errors.push(`fatal: pathspec '${this.relPath(path)}' did not match any files`);
      }

      if (this.mergeState) this.mergeState.conflicts = [...conflicts];

      if (errors.length) return { ok: false, exitCode: 1, stdout: [], stderr: errors };

      this.lastEvent = { type: "git_add", paths: added.map((p) => this.relPath(p)) };
      return { ok: true, exitCode: 0, stdout: [], stderr: [] };
    }

    gitCommit(args) {
      const init = this.ensureInitialized();
      if (!init.ok) return init;

      const status = this.getStatus();
      const hasStaged = status.staged.length > 0 || Object.keys(this.stagedFiles).length > 0;
      if (!hasStaged) {
        return { ok: false, exitCode: 1, stdout: [], stderr: ["nothing to commit (no staged changes)"] };
      }

      if (this.mergeState && (this.mergeState.conflicts?.length || 0) > 0) {
        return {
          ok: false,
          exitCode: 1,
          stdout: [],
          stderr: ["error: Committing is not possible because you have unmerged files."],
        };
      }

      let message = "";
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "-m" && typeof args[i + 1] === "string") {
          message = args[i + 1];
          break;
        }
      }

      if (!message) {
        message = this.mergeState ? `Merge branch '${this.mergeState.theirBranch}'` : "Commit";
      }

      const parents = [];
      if (this.head) parents.push(this.head);
      if (this.mergeState?.theirHash) parents.push(this.mergeState.theirHash);

      const base = deepCopy(this.getHeadSnapshot());
      const next = base;

      for (const [path, content] of Object.entries(this.stagedFiles)) {
        if (content === null) delete next[path];
        else next[path] = content;
      }

      const hash = this.genHash();
      this.ensureBranchMeta(this.currentBranch);
      const meta = this.branchMeta[this.currentBranch];

      this.commits[hash] = {
        hash,
        message,
        parents,
        timestamp: nowMs(),
        files: next,
        lane: meta.lane,
        branch: this.currentBranch,
      };
      this.commitOrder.push(hash);
      this.head = hash;

      // Update working tree to match committed snapshot for files we staged.
      for (const [path, content] of Object.entries(this.stagedFiles)) {
        if (content === null) delete this.workingFiles[path];
        else this.workingFiles[path] = content;
      }

      this.stagedFiles = {};
      this.mergeState = null;

      this.lastEvent = { type: "git_commit", hash, message };

      return {
        ok: true,
        exitCode: 0,
        stdout: [
          `[${this.currentBranch} ${shortHash(hash)}] ${message}`,
          `${status.staged.length || Object.keys(next).length} file(s) changed (simulated)`,
        ],
        stderr: [],
      };
    }

    gitLog(args) {
      const init = this.ensureInitialized();
      if (!init.ok) return init;

      const hash = this.head;
      if (!hash) return { ok: false, exitCode: 1, stdout: [], stderr: ["fatal: your current branch has no commits"] };

      const oneline = args.includes("--oneline");
      const out = [];
      let cur = hash;
      const seen = new Set();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const c = this.commits[cur];
        if (!c) break;
        if (oneline) out.push(`${shortHash(c.hash)} ${c.message}`);
        else {
          out.push(`commit ${c.hash}`);
          out.push(`Date:   ${new Date(c.timestamp).toLocaleString()}`);
          out.push("");
          out.push(`    ${c.message}`);
          out.push("");
        }
        cur = (c.parents || [])[0] || null;
      }
      return { ok: true, exitCode: 0, stdout: out, stderr: [] };
    }

    gitBranch(args) {
      const init = this.ensureInitialized();
      if (!init.ok) return init;

      const name = args[0];
      if (!name) {
        const out = Object.keys(this.branches)
          .sort()
          .map((b) => (b === this.currentBranch ? `* ${b}` : `  ${b}`));
        return { ok: true, exitCode: 0, stdout: out, stderr: [] };
      }

      if (this.branches[name] !== undefined) {
        return { ok: false, exitCode: 1, stdout: [], stderr: [`fatal: A branch named '${name}' already exists.`] };
      }

      this.branches[name] = this.head;
      this.ensureBranchMeta(name);
      this.lastEvent = { type: "git_branch_create", branch: name };
      return { ok: true, exitCode: 0, stdout: [], stderr: [] };
    }

    gitCheckout(args) {
      const init = this.ensureInitialized();
      if (!init.ok) return init;

      const status = this.getStatus();
      if (status.isDirty) {
        return {
          ok: false,
          exitCode: 1,
          stdout: [],
          stderr: [
            "error: Your local changes would be overwritten by checkout (simulated).",
            "Hint: commit, stash, or reset before switching branches.",
          ],
        };
      }

      if (!args.length) return { ok: false, exitCode: 1, stdout: [], stderr: ["fatal: branch name required"] };

      // Support: git checkout -b <name>
      if (args[0] === "-b") {
        const name = args[1];
        if (!name) return { ok: false, exitCode: 1, stdout: [], stderr: ["fatal: -b requires a branch name"] };
        if (this.branches[name] !== undefined) {
          return { ok: false, exitCode: 1, stdout: [], stderr: [`fatal: A branch named '${name}' already exists.`] };
        }
        this.branches[name] = this.head;
        this.ensureBranchMeta(name);
        this.currentBranch = name;
        this.workingFiles = deepCopy(this.getHeadSnapshot());
        this.lastEvent = { type: "git_checkout_new", branch: name };
        return { ok: true, exitCode: 0, stdout: [`Switched to a new branch '${name}'`], stderr: [] };
      }

      const name = args[0];
      if (this.branches[name] === undefined) {
        return { ok: false, exitCode: 1, stdout: [], stderr: [`error: pathspec '${name}' did not match any branch`] };
      }

      this.currentBranch = name;
      this.ensureBranchMeta(name);
      this.workingFiles = deepCopy(this.getHeadSnapshot());
      this.stagedFiles = {};
      this.mergeState = null;
      this.lastEvent = { type: "git_checkout", branch: name };
      return { ok: true, exitCode: 0, stdout: [`Switched to branch '${name}'`], stderr: [] };
    }

    gitMerge(args) {
      const init = this.ensureInitialized();
      if (!init.ok) return init;

      const status = this.getStatus();
      if (status.isDirty) {
        return {
          ok: false,
          exitCode: 1,
          stdout: [],
          stderr: ["error: cannot merge because you have local changes (simulated).", "Hint: commit or stash first."],
        };
      }

      const theirBranch = args[0];
      if (!theirBranch) return { ok: false, exitCode: 1, stdout: [], stderr: ["fatal: branch name required"] };
      if (this.branches[theirBranch] === undefined) {
        return { ok: false, exitCode: 1, stdout: [], stderr: [`fatal: branch '${theirBranch}' not found`] };
      }

      const ours = this.head;
      const theirs = this.branches[theirBranch];
      if (!theirs) return { ok: true, exitCode: 0, stdout: ["Already up to date."], stderr: [] };
      if (!ours) {
        // No commits on current branch: fast-forward to theirs.
        this.head = theirs;
        this.workingFiles = deepCopy(this.getHeadSnapshot());
        this.lastEvent = { type: "git_merge_ff", branch: theirBranch };
        return { ok: true, exitCode: 0, stdout: ["Fast-forward (simulated)."], stderr: [] };
      }

      if (this.isAncestor(ours, theirs)) {
        this.head = theirs;
        this.workingFiles = deepCopy(this.getHeadSnapshot());
        this.lastEvent = { type: "git_merge_ff", branch: theirBranch };
        return { ok: true, exitCode: 0, stdout: ["Fast-forward (simulated)."], stderr: [] };
      }

      if (this.isAncestor(theirs, ours)) {
        return { ok: true, exitCode: 0, stdout: ["Already up to date."], stderr: [] };
      }

      const baseHash = this.findCommonAncestor(ours, theirs);
      const base = this.getSnapshot(baseHash);
      const oursSnap = this.getSnapshot(ours);
      const theirsSnap = this.getSnapshot(theirs);
      const merged = deepCopy(oursSnap);

      const paths = new Set([...Object.keys(base), ...Object.keys(oursSnap), ...Object.keys(theirsSnap)]);
      const conflicts = [];

      for (const path of paths) {
        const b = base[path];
        const o = oursSnap[path];
        const t = theirsSnap[path];

        // Same result on both sides.
        if (o === t) {
          if (o === undefined) delete merged[path];
          else merged[path] = o;
          continue;
        }
        // Ours unchanged from base: take theirs.
        if (o === b) {
          if (t === undefined) delete merged[path];
          else merged[path] = t;
          continue;
        }
        // Theirs unchanged from base: keep ours.
        if (t === b) {
          if (o === undefined) delete merged[path];
          else merged[path] = o;
          continue;
        }

        // Conflict.
        conflicts.push(path);
        const oursText = o ?? "";
        const theirsText = t ?? "";
        merged[path] = `<<<<<<< HEAD\n${oursText}\n=======\n${theirsText}\n>>>>>>> ${theirBranch}\n`;
      }

      this.workingFiles = merged;
      this.stagedFiles = {};

      if (conflicts.length) {
        this.mergeState = { theirBranch, theirHash: theirs, conflicts };
        this.lastEvent = { type: "git_merge_conflict", branch: theirBranch, conflicts: conflicts.map((p) => this.relPath(p)) };
        const out = ["Auto-merging (simulated)…", "CONFLICT (content): Merge conflict in " + this.relPath(conflicts[0])];
        if (conflicts.length > 1) out.push(`(${conflicts.length - 1} more conflict(s))`);
        out.push('Fix conflicts, then run "git add <file>" and "git commit".');
        return { ok: false, exitCode: 1, stdout: out, stderr: [] };
      }

      // No conflicts: auto-create a merge commit.
      this.mergeState = { theirBranch, theirHash: theirs, conflicts: [] };
      // Stage everything resulting from merge, then commit.
      for (const [path, content] of Object.entries(this.workingFiles)) this.stagedFiles[path] = content;
      // Also stage deletions where ours had it but merge removed it.
      for (const path of Object.keys(oursSnap)) {
        if (!Object.prototype.hasOwnProperty.call(this.workingFiles, path)) this.stagedFiles[path] = null;
      }
      const res = this.gitCommit(["-m", `Merge branch '${theirBranch}'`]);
      res.stdout.unshift("Merge made by Git Tutor (simulated).");
      this.lastEvent = { type: "git_merge", branch: theirBranch };
      return res;
    }

    gitRemote(args, ctx) {
      const init = this.ensureInitialized();
      if (!init.ok) return init;
      const store = ctx?.remoteStore;
      if (!store) return { ok: false, exitCode: 1, stdout: [], stderr: ["internal error: remote store missing"] };

      const sub = args[0];
      if (!sub) {
        const out = Object.keys(this.remotes)
          .sort()
          .map((name) => name);
        return { ok: true, exitCode: 0, stdout: out, stderr: [] };
      }

      if (sub === "-v") {
        const out = [];
        for (const name of Object.keys(this.remotes).sort()) {
          const url = this.remotes[name].url;
          out.push(`${name}\t${url} (fetch)`);
          out.push(`${name}\t${url} (push)`);
        }
        return { ok: true, exitCode: 0, stdout: out, stderr: [] };
      }

      if (sub === "add") {
        const name = args[1];
        const url = args[2];
        if (!name || !url) {
          return { ok: false, exitCode: 1, stdout: [], stderr: ["usage: git remote add <name> <url>"] };
        }
        if (this.remotes[name]) return { ok: false, exitCode: 1, stdout: [], stderr: [`fatal: remote ${name} already exists`] };
        store.ensureRepo(url);
        this.remotes[name] = { url };
        this.lastEvent = { type: "git_remote_add", name, url };
        return { ok: true, exitCode: 0, stdout: [], stderr: [] };
      }

      return { ok: false, exitCode: 1, stdout: [], stderr: ["usage: git remote [-v] | git remote add <name> <url>"] };
    }

    gitPush(args, ctx) {
      const init = this.ensureInitialized();
      if (!init.ok) return init;

      const store = ctx?.remoteStore;
      if (!store) return { ok: false, exitCode: 1, stdout: [], stderr: ["internal error: remote store missing"] };

      let setUpstream = false;
      const cleaned = [];
      for (const a of args) {
        if (a === "-u" || a === "--set-upstream") setUpstream = true;
        else cleaned.push(a);
      }

      const remoteName = cleaned[0] || this.upstreams[this.currentBranch]?.remote || "origin";
      const branchName = cleaned[1] || this.currentBranch;

      const remote = this.remotes[remoteName];
      if (!remote) {
        return { ok: false, exitCode: 1, stdout: [], stderr: [`fatal: '${remoteName}' does not appear to be a git remote`] };
      }

      const url = remote.url;
      const remoteRepo = store.ensureRepo(url);

      const localHead = this.branches[branchName];
      if (!localHead) {
        return { ok: false, exitCode: 1, stdout: [], stderr: [`error: src refspec ${branchName} does not match any`] };
      }

      // Copy missing commits over.
      for (const hash of this.commitOrder) {
        if (!remoteRepo.commits[hash]) remoteRepo.commits[hash] = deepCopy(this.commits[hash]);
      }
      // Merge commit order (keep existing order, then append missing).
      const existing = new Set(remoteRepo.commitOrder);
      for (const hash of this.commitOrder) {
        if (!existing.has(hash)) remoteRepo.commitOrder.push(hash);
      }

      const old = remoteRepo.branches[branchName] || null;
      remoteRepo.branches[branchName] = localHead;

      if (setUpstream) this.upstreams[branchName] = { remote: remoteName, branch: branchName };

      this.lastEvent = { type: "git_push", remote: remoteName, branch: branchName };

      const out = [`To ${url}`];
      out.push(`   ${shortHash(old) || "0000000"}..${shortHash(localHead)}  ${branchName} -> ${branchName}`);
      if (setUpstream) out.push(`Branch '${branchName}' set up to track '${remoteName}/${branchName}'. (simulated)`);
      return { ok: true, exitCode: 0, stdout: out, stderr: [] };
    }

    gitPull(args, ctx) {
      const init = this.ensureInitialized();
      if (!init.ok) return init;

      const store = ctx?.remoteStore;
      if (!store) return { ok: false, exitCode: 1, stdout: [], stderr: ["internal error: remote store missing"] };

      const status = this.getStatus();
      if (status.isDirty) {
        return {
          ok: false,
          exitCode: 1,
          stdout: [],
          stderr: ["error: cannot pull with local changes (simulated).", "Hint: commit or stash first."],
        };
      }

      const remoteName = args[0] || this.upstreams[this.currentBranch]?.remote || "origin";
      const branchName = args[1] || this.upstreams[this.currentBranch]?.branch || this.currentBranch;

      const remote = this.remotes[remoteName];
      if (!remote) return { ok: false, exitCode: 1, stdout: [], stderr: [`fatal: remote '${remoteName}' not found`] };

      const remoteRepo = store.getRepo(remote.url);
      if (!remoteRepo) return { ok: false, exitCode: 1, stdout: [], stderr: [`fatal: remote URL not found: ${remote.url}`] };

      const remoteHead = remoteRepo.branches[branchName];
      if (!remoteHead) return { ok: false, exitCode: 1, stdout: [], stderr: [`fatal: remote branch '${branchName}' not found`] };

      // Bring missing commits into local.
      for (const hash of remoteRepo.commitOrder) {
        if (!this.commits[hash] && remoteRepo.commits[hash]) {
          this.commits[hash] = deepCopy(remoteRepo.commits[hash]);
          this.commitOrder.push(hash);
        }
      }

      const ours = this.head;
      const theirs = remoteHead;

      if (!ours || this.isAncestor(ours, theirs)) {
        // Fast-forward.
        this.head = theirs;
        this.workingFiles = deepCopy(this.getHeadSnapshot());
        this.lastEvent = { type: "git_pull_ff", remote: remoteName, branch: branchName };
        return { ok: true, exitCode: 0, stdout: ["Fast-forward (simulated)."], stderr: [] };
      }

      if (this.isAncestor(theirs, ours)) {
        return { ok: true, exitCode: 0, stdout: ["Already up to date."], stderr: [] };
      }

      // Diverged: merge remote into current branch.
      const label = `${remoteName}/${branchName}`;
      // Create a temporary branch pointer for merge algorithm.
      const tmpName = `__remote_${label}`;
      this.branches[tmpName] = theirs;
      const res = this.gitMerge([tmpName]);
      delete this.branches[tmpName];
      if (res.ok) res.stdout.unshift(`Merge from ${label} (simulated).`);
      else res.stdout.unshift(`Merge from ${label} requires conflict resolution (simulated).`);
      this.lastEvent = { type: "git_pull_merge", remote: remoteName, branch: branchName };
      return res;
    }

    gitClone(args, ctx) {
      const store = ctx?.remoteStore;
      if (!store) return { ok: false, exitCode: 1, stdout: [], stderr: ["internal error: remote store missing"] };
      const url = args[0];
      if (!url) return { ok: false, exitCode: 1, stdout: [], stderr: ["usage: git clone <url>"] };

      const remoteRepo = store.ensureRepo(url);

      // Replace this repo with remote content.
      this.reset();
      this.initialized = true;
      this.remotes.origin = { url };
      this.upstreams.main = { remote: "origin", branch: "main" };
      this.commits = deepCopy(remoteRepo.commits);
      this.commitOrder = Array.isArray(remoteRepo.commitOrder) ? [...remoteRepo.commitOrder] : [];
      this.branches = deepCopy(remoteRepo.branches);
      this.currentBranch = "main";
      this.branchMeta.main = { lane: 0, color: BRANCH_COLORS[0] };
      this.nextLane = 1;
      this.workingFiles = deepCopy(this.getHeadSnapshot());
      for (const p of Object.keys(this.workingFiles)) this.directories[dirname(p)] = true;

      this.lastEvent = { type: "git_clone", url };
      return { ok: true, exitCode: 0, stdout: [`Cloning into '${basename(url)}'… (simulated)`, "done."], stderr: [] };
    }

    gitStash(args) {
      const init = this.ensureInitialized();
      if (!init.ok) return init;

      if (args[0] === "pop") {
        if (!this.stash.length) return { ok: false, exitCode: 1, stdout: [], stderr: ["No stash entries found."] };
        const entry = this.stash.shift();
        this.workingFiles = entry.workingFiles;
        this.stagedFiles = entry.stagedFiles;
        this.mergeState = null;
        this.lastEvent = { type: "git_stash_pop" };
        return { ok: true, exitCode: 0, stdout: ["Applied stash (simulated)."], stderr: [] };
      }

      const status = this.getStatus();
      if (!status.isDirty) return { ok: false, exitCode: 1, stdout: [], stderr: ["No local changes to save."] };

      const message = `WIP on ${this.currentBranch}: ${shortHash(this.head)} (simulated)`;
      this.stash.unshift({
        message,
        workingFiles: deepCopy(this.workingFiles),
        stagedFiles: deepCopy(this.stagedFiles),
        createdAt: nowMs(),
      });
      this.workingFiles = deepCopy(this.getHeadSnapshot());
      this.stagedFiles = {};
      this.mergeState = null;
      this.lastEvent = { type: "git_stash" };
      return { ok: true, exitCode: 0, stdout: [`Saved working directory and index state: ${message}`], stderr: [] };
    }

    gitReset(args) {
      const init = this.ensureInitialized();
      if (!init.ok) return init;

      if (args[0] !== "--hard") {
        return { ok: false, exitCode: 1, stdout: [], stderr: ["Only '--hard' is supported in this tutorial."] };
      }

      const target = args[1] || "HEAD";
      let targetHash = null;
      if (target === "HEAD") targetHash = this.head;
      else if (target === "HEAD~1") {
        const headCommit = this.commits[this.head];
        targetHash = headCommit?.parents?.[0] || null;
      } else {
        // Assume it's a hash prefix.
        const full = this.resolveHashPrefix(target);
        if (!full) return { ok: false, exitCode: 1, stdout: [], stderr: [`fatal: ambiguous argument '${target}'`] };
        targetHash = full;
      }

      this.head = targetHash;
      this.workingFiles = deepCopy(this.getHeadSnapshot());
      this.stagedFiles = {};
      this.mergeState = null;
      this.lastEvent = { type: "git_reset_hard", target };
      return { ok: true, exitCode: 0, stdout: [`HEAD is now at ${shortHash(targetHash)} (simulated).`], stderr: [] };
    }

    resolveHashPrefix(prefix) {
      const p = String(prefix || "").toLowerCase();
      if (!p) return null;
      const hashes = Object.keys(this.commits);
      const matches = hashes.filter((h) => h.toLowerCase().startsWith(p));
      if (matches.length === 1) return matches[0];
      return null;
    }

    gitRevert(args) {
      const init = this.ensureInitialized();
      if (!init.ok) return init;
      const hashArg = args[0];
      if (!hashArg) return { ok: false, exitCode: 1, stdout: [], stderr: ["usage: git revert <hash>"] };
      const full = this.resolveHashPrefix(hashArg) || (this.commits[hashArg] ? hashArg : null);
      if (!full) return { ok: false, exitCode: 1, stdout: [], stderr: [`fatal: bad revision '${hashArg}'`] };

      const commit = this.commits[full];
      const parentHash = commit.parents?.[0] || null;
      const parentFiles = this.getSnapshot(parentHash);
      const commitFiles = commit.files || {};
      const headFiles = deepCopy(this.getHeadSnapshot());

      // Compute inverse patch for commit relative to parent.
      const paths = new Set([...Object.keys(parentFiles), ...Object.keys(commitFiles)]);
      for (const path of paths) {
        const before = parentFiles[path];
        const after = commitFiles[path];
        if (before === after) continue;

        // Added in commit -> delete.
        if (before === undefined && after !== undefined) {
          delete headFiles[path];
          continue;
        }
        // Deleted in commit -> restore.
        if (before !== undefined && after === undefined) {
          headFiles[path] = before;
          continue;
        }
        // Modified -> restore 'before'.
        headFiles[path] = before;
      }

      // Create a new commit directly (like Git does).
      this.stagedFiles = {};
      for (const [path, content] of Object.entries(headFiles)) this.stagedFiles[path] = content;
      // Stage deletions (files that existed in current head but not in headFiles).
      for (const path of Object.keys(this.getHeadSnapshot())) {
        if (!Object.prototype.hasOwnProperty.call(headFiles, path)) this.stagedFiles[path] = null;
      }

      const msg = `Revert "${commit.message}"`;
      const res = this.gitCommit(["-m", msg]);
      this.lastEvent = { type: "git_revert", hash: full };
      return res.ok
        ? { ...res, stdout: [`Reverted ${shortHash(full)} (simulated).`, ...res.stdout] }
        : { ...res, stderr: ["revert failed (simulated)", ...res.stderr] };
    }
  }

  // -----------------------------
  // Lesson definitions
  // -----------------------------

  function lessonIntro(html) {
    return `<p>${html}</p>`;
  }

  const LESSONS = [
    {
      id: "lesson1",
      title: "Getting Started",
      short: "init, status, files",
      introHtml:
        lessonIntro(
          `In this lesson you’ll initialize a repo and practice basic file commands. Watch how <code>git status</code> reacts as files appear in the working directory.`
        ) +
        lessonIntro(
          `Tip: The Files panel shows <code>A</code> for untracked/added files and highlights staged changes with <code>S</code>.`
        ),
      setup(repo, ctx) {
        repo.reset();
        repo.cwd = "/";
        // Give learners something to see even before init.
        repo.directories["/docs"] = true;
        repo.workingFiles["/docs/tips.txt"] = "Try: git init\nTry: git status\n";
      },
      steps: [
        {
          title: "Initialize a repository",
          text: `Run <code>git init</code> to create an empty repository.`,
          hint: `Type <code>git init</code> then press Enter.`,
          validate: ({ command, repo }) => command.trim() === "git init" && repo.initialized,
        },
        {
          title: "Check status",
          text: `Run <code>git status</code>. Notice you have an untracked file.`,
          hint: `Type <code>git status</code>.`,
          validate: ({ command, repo }) => command.trim() === "git status" && repo.getStatus().untracked.length > 0,
        },
        {
          title: "Create a README",
          text: `Create <code>README.md</code> using: <code>echo "# Git Tutor" &gt; README.md</code>.`,
          hint: `Use the sample command exactly, including the <code>&gt;</code>.`,
          validate: ({ repo }) => Object.prototype.hasOwnProperty.call(repo.workingFiles, "/README.md"),
        },
        {
          title: "List files",
          text: `Run <code>ls</code> and confirm <code>README.md</code> exists.`,
          hint: `Type <code>ls</code>.`,
          validate: ({ command, repo }) => command.trim() === "ls" && Object.keys(repo.workingFiles).some((p) => p === "/README.md"),
        },
        {
          title: "View the file",
          text: `Run <code>cat README.md</code> to print its contents.`,
          hint: `Type <code>cat README.md</code>.`,
          validate: ({ command }) => command.trim() === "cat README.md",
        },
      ],
      quiz: {
        title: "Lesson 1 Quiz",
        questions: [
          {
            q: "What does `git init` do?",
            options: ["Uploads your code to GitHub", "Creates a new Git repository", "Creates your first commit"],
            answer: 1,
          },
          {
            q: "Which command shows staged and unstaged changes?",
            options: ["git status", "git branch", "git merge"],
            answer: 0,
          },
          {
            q: "In Git status, an 'untracked file' means:",
            options: ["It is staged", "Git hasn't started tracking it yet", "It is in the stash"],
            answer: 1,
          },
        ],
      },
    },
    {
      id: "lesson2",
      title: "Making Commits",
      short: "add, commit, log",
      introHtml:
        lessonIntro(
          `Now you’ll stage changes with <code>git add</code>, create commits with <code>git commit</code>, and inspect history with <code>git log</code>. As you commit, the Git graph will update.`
        ) +
        lessonIntro(
          `You can always reset to the start of the current step using <strong>Reset repo</strong>.`
        ),
      setup(repo) {
        repo.reset();
        repo.gitInit();
      },
      steps: [
        {
          title: "Create a README",
          text: `Create a file: <code>echo "# My Project" &gt; README.md</code>.`,
          hint: `Use <code>echo</code> + redirection to write the file.`,
          validate: ({ repo }) => Object.prototype.hasOwnProperty.call(repo.workingFiles, "/README.md"),
        },
        {
          title: "Stage the file",
          text: `Stage it: <code>git add README.md</code>.`,
          hint: `Use <code>git add README.md</code>.`,
          validate: ({ command, repo }) =>
            command.trim() === "git add README.md" && Object.prototype.hasOwnProperty.call(repo.stagedFiles, "/README.md"),
        },
        {
          title: "Make your first commit",
          text: `Commit with a message: <code>git commit -m "Add README"</code>.`,
          hint: `Be sure to include <code>-m</code> and quotes around the message.`,
          validate: ({ command, repo }) => command.includes("git commit") && repo.commitOrder.length === 1,
        },
        {
          title: "View history",
          text: `Run <code>git log --oneline</code> to see your commit.`,
          hint: `Type <code>git log --oneline</code>.`,
          validate: ({ command }) => command.trim() === "git log --oneline",
        },
        {
          title: "Make a second commit",
          text: `Update README (use <code>edit README.md</code> or an <code>echo</code>) and create a second commit.`,
          hint: `Workflow: edit → <code>git add README.md</code> → <code>git commit -m "Update README"</code>.`,
          validate: ({ repo }) => repo.commitOrder.length >= 2,
        },
      ],
      quiz: {
        title: "Lesson 2 Quiz",
        questions: [
          {
            q: "What is the Git 'index' commonly called?",
            options: ["Working tree", "Staging area", "Remote"],
            answer: 1,
          },
          {
            q: "Which command creates a commit?",
            options: ["git add", "git commit", "git status"],
            answer: 1,
          },
          {
            q: "Why is `git log --oneline` useful?",
            options: ["It shows compact history", "It deletes commits", "It creates branches"],
            answer: 0,
          },
        ],
      },
    },
    {
      id: "lesson3",
      title: "Branching Basics",
      short: "branch, checkout",
      introHtml:
        lessonIntro(
          `Branches let you work on features without disturbing <code>main</code>. You’ll create a branch, switch to it, commit, then switch back.`
        ) +
        lessonIntro(
          `Watch the Git graph: branches get different colors and lanes.`
        ),
      setup(repo) {
        repo.reset();
        repo.gitInit();
        repo.workingFiles["/README.md"] = "# Branching Demo\n";
        repo.gitAdd(["README.md"]);
        repo.gitCommit(["-m", "Initial commit"]);
      },
      steps: [
        {
          title: "List branches",
          text: `Run <code>git branch</code> to list branches.`,
          hint: `Type <code>git branch</code>.`,
          validate: ({ command }) => command.trim() === "git branch",
        },
        {
          title: "Create a feature branch",
          text: `Create a branch: <code>git branch feature/login</code>.`,
          hint: `Type <code>git branch feature/login</code>.`,
          validate: ({ repo }) => repo.branches["feature/login"] !== undefined,
        },
        {
          title: "Switch branches",
          text: `Switch to it: <code>git checkout feature/login</code>.`,
          hint: `Type <code>git checkout feature/login</code>.`,
          validate: ({ repo }) => repo.currentBranch === "feature/login",
        },
        {
          title: "Add a file on the feature branch",
          text: `Create <code>login.js</code>: <code>echo "console.log('login')" &gt; login.js</code>.`,
          hint: `Use the sample command to create the file.`,
          validate: ({ repo }) => Object.prototype.hasOwnProperty.call(repo.workingFiles, "/login.js"),
        },
        {
          title: "Commit on the branch",
          text: `Stage and commit <code>login.js</code>.`,
          hint: `Run <code>git add login.js</code> then <code>git commit -m "Add login"</code>.`,
          validate: ({ repo }) => repo.commitOrder.length >= 2 && repo.branches["feature/login"] === repo.head,
        },
        {
          title: "Switch back to main",
          text: `Switch back: <code>git checkout main</code>.`,
          hint: `Type <code>git checkout main</code>.`,
          validate: ({ repo }) => repo.currentBranch === "main",
        },
      ],
      quiz: {
        title: "Lesson 3 Quiz",
        questions: [
          {
            q: "What does `git branch feature/x` do?",
            options: ["Switches to feature/x", "Creates feature/x at the current commit", "Deletes feature/x"],
            answer: 1,
          },
          {
            q: "After committing on a feature branch, what happens to main?",
            options: ["Main gets the commit automatically", "Main is unchanged until you merge", "Main is deleted"],
            answer: 1,
          },
          {
            q: "Which command switches branches in this tutorial?",
            options: ["git checkout", "git fork", "git upload"],
            answer: 0,
          },
        ],
      },
    },
    {
      id: "lesson4",
      title: "Merging (and Conflicts)",
      short: "merge, resolve",
      introHtml:
        lessonIntro(
          `Merging combines work from two branches. If both branches change the same lines, Git reports a conflict and asks you to resolve it.`
        ) +
        lessonIntro(
          `In this lesson you’ll create a conflict on purpose, resolve it in the editor, then finish the merge.`
        ),
      setup(repo) {
        repo.reset();
        repo.gitInit();
        repo.workingFiles["/config.txt"] = "color=blue\n";
        repo.gitAdd(["config.txt"]);
        repo.gitCommit(["-m", "Add config"]);

        repo.gitCheckout(["-b", "feature/theme"]);
        repo.workingFiles["/config.txt"] = "color=green\n";
        repo.gitAdd(["config.txt"]);
        repo.gitCommit(["-m", "Theme: green"]);

        repo.gitCheckout(["main"]);
        repo.workingFiles["/config.txt"] = "color=red\n";
        repo.gitAdd(["config.txt"]);
        repo.gitCommit(["-m", "Theme: red"]);
      },
      steps: [
        {
          title: "Merge the feature branch",
          text: `Run <code>git merge feature/theme</code> to merge. You should get a conflict.`,
          hint: `Type <code>git merge feature/theme</code>.`,
          validate: ({ command, repo }) => command.trim() === "git merge feature/theme" && !!repo.mergeState,
        },
        {
          title: "Inspect the conflict",
          text: `Open the file: <code>edit config.txt</code>. Remove the conflict markers and set <code>color=purple</code>.`,
          hint: `Use the editor modal, then save.`,
          validate: ({ repo }) => {
            const content = repo.workingFiles["/config.txt"] || "";
            return !content.includes("<<<<<<<") && content.includes("color=purple");
          },
        },
        {
          title: "Stage the resolution",
          text: `Stage your fix: <code>git add config.txt</code>.`,
          hint: `Type <code>git add config.txt</code>.`,
          validate: ({ repo }) =>
            Object.prototype.hasOwnProperty.call(repo.stagedFiles, "/config.txt") &&
            (repo.mergeState?.conflicts?.length || 0) === 0,
        },
        {
          title: "Finish the merge",
          text: `Commit to conclude the merge: <code>git commit -m "Merge theme"</code>.`,
          hint: `Type the commit command with a message.`,
          validate: ({ repo }) => !repo.mergeState && repo.commitOrder.length >= 4,
        },
      ],
      quiz: {
        title: "Lesson 4 Quiz",
        questions: [
          {
            q: "What typically causes a merge conflict?",
            options: ["Both branches changed the same lines", "You forgot to run git init", "Your repo has too many commits"],
            answer: 0,
          },
          {
            q: "After resolving a conflict, what do you do next?",
            options: ["Delete the repo", "Run git add on the resolved file(s)", "Run git clone"],
            answer: 1,
          },
          {
            q: "A merge commit usually has:",
            options: ["No parents", "One parent", "Two parents"],
            answer: 2,
          },
        ],
      },
    },
    {
      id: "lesson5",
      title: "Remote Operations",
      short: "clone, push, pull",
      introHtml:
        lessonIntro(
          `Remotes let you share work. In this tutorial, remotes are simulated (no network). You’ll clone a repo, commit, push, then pull a teammate’s change.`
        ) +
        lessonIntro(
          `Tip: Use <code>git remote -v</code> to confirm where you’re pushing/pulling.`
        ),
      setup(repo, ctx) {
        repo.reset();
        // Seed remote used in this lesson.
        const url = ctx.seedRemoteUrl;
        repo.gitClone([url], ctx);
      },
      steps: [
        {
          title: "Confirm your remote",
          text: `Run <code>git remote -v</code>.`,
          hint: `Type <code>git remote -v</code>.`,
          validate: ({ command }) => command.trim() === "git remote -v",
        },
        {
          title: "Make a commit locally",
          text: `Edit <code>README.md</code> (or use <code>echo</code>), then commit the change.`,
          hint: `Try: <code>edit README.md</code> → <code>git add README.md</code> → <code>git commit -m "Update README"</code>.`,
          // The seed remote has 2 commits; require at least one new local commit.
          validate: ({ repo }) => repo.commitOrder.length >= 3,
        },
        {
          title: "Push to origin",
          text: `Push your commit: <code>git push -u origin main</code>.`,
          hint: `Type <code>git push -u origin main</code>.`,
          validate: ({ command, repo }) =>
            command.trim() === "git push -u origin main" && repo.lastEvent?.type === "git_push",
        },
        {
          title: "Pull a teammate’s change",
          text: `A teammate pushed a commit to <code>origin/main</code>. Run <code>git pull</code> to update.`,
          hint: `Type <code>git pull</code>.`,
          validate: ({ command, repo }) =>
            command.trim() === "git pull" &&
            repo.lastEvent?.type?.startsWith("git_pull") &&
            // After clone (2) + your commit (3), pulling teammate makes it 4.
            repo.commitOrder.length >= 4,
        },
      ],
      quiz: {
        title: "Lesson 5 Quiz",
        questions: [
          {
            q: "What does `git push` do?",
            options: ["Downloads commits from a remote", "Uploads commits to a remote", "Shows the commit graph"],
            answer: 1,
          },
          {
            q: "What does `git pull` do (conceptually)?",
            options: ["Fetch + merge/fast-forward", "Create a branch", "Delete a remote"],
            answer: 0,
          },
          {
            q: "`git clone` typically sets up which remote name by default?",
            options: ["upstream", "origin", "main"],
            answer: 1,
          },
        ],
      },
      // This hook is used to simulate a teammate commit once the learner successfully pushes.
      onStepComplete({ stepIndex, repo, ctx }) {
        if (stepIndex !== 2) return;
        ctx.simulateTeammateCommitToOriginMain(repo);
      },
    },
    {
      id: "lesson6",
      title: "Collaboration & Recovery",
      short: "stash, reset, revert",
      introHtml:
        lessonIntro(
          `Real-world Git is mostly about safe collaboration. You’ll practice <code>stash</code> (park work), <code>reset --hard</code> (discard local mistakes), and <code>revert</code> (undo a commit safely in shared history).`
        ) +
        lessonIntro(
          `This lesson uses a simulated remote with commits that represent a teammate’s work.`
        ),
      setup(repo, ctx) {
        repo.reset();
        repo.gitClone([ctx.seedRemoteUrl], ctx);
        // Simulate a teammate pushing after you cloned (so `git pull` has something to do).
        ctx.simulateTeammateCommitToOriginMain(repo);
      },
      steps: [
        {
          title: "Create uncommitted work",
          text: `Create a work-in-progress file: <code>echo "WIP" &gt; NOTES.md</code>.`,
          hint: `Use the echo + redirect command.`,
          validate: ({ repo }) => Object.prototype.hasOwnProperty.call(repo.workingFiles, "/NOTES.md"),
        },
        {
          title: "Stash it",
          text: `Run <code>git stash</code>. Your working directory should become clean.`,
          hint: `Type <code>git stash</code>.`,
          validate: ({ command, repo }) => command.trim() === "git stash" && repo.stash.length === 1 && !repo.getStatus().isDirty,
        },
        {
          title: "Pull remote updates",
          text: `Pull changes from origin: <code>git pull</code>.`,
          hint: `Type <code>git pull</code>.`,
          validate: ({ command, repo, app }) => {
            if (command.trim() !== "git pull") return false;
            if (repo.lastEvent?.type !== "git_pull_ff" && repo.lastEvent?.type !== "git_pull_merge") return false;
            const start = app.checkpoints[app.stepIndex];
            if (!start) return true;
            const startRepo = SimulatedRepo.deserialize(start);
            return repo.head !== startRepo.head;
          },
        },
        {
          title: "Bring your work back",
          text: `Restore your stashed changes: <code>git stash pop</code>.`,
          hint: `Type <code>git stash pop</code>.`,
          validate: ({ command, repo }) =>
            command.trim() === "git stash pop" && Object.prototype.hasOwnProperty.call(repo.workingFiles, "/NOTES.md"),
        },
        {
          title: "Commit, then undo it locally",
          text: `Commit <code>NOTES.md</code>, then undo it using <code>git reset --hard HEAD~1</code>.`,
          hint: `Commit flow: <code>git add NOTES.md</code> → <code>git commit -m "Add notes"</code> → reset hard.`,
          validate: ({ repo, app }) => {
            if (repo.lastEvent?.type !== "git_reset_hard") return false;
            if (Object.prototype.hasOwnProperty.call(repo.workingFiles, "/NOTES.md")) return false;
            const start = app.checkpoints[app.stepIndex];
            if (!start) return true;
            const startRepo = SimulatedRepo.deserialize(start);
            // They created at least one new commit, then reset back to the original HEAD.
            return repo.commitOrder.length > startRepo.commitOrder.length && repo.head === startRepo.head;
          },
        },
        {
          title: "Revert a bad commit (safe for sharing)",
          text: `Run <code>git log --oneline</code>, then revert the newest commit using <code>git revert &lt;hash&gt;</code>.`,
          hint: `Copy the short hash from log, then run <code>git revert</code>.`,
          validate: ({ repo }) => repo.commitOrder.length >= 3 && repo.lastEvent?.type === "git_revert",
        },
      ],
      quiz: {
        title: "Lesson 6 Quiz",
        questions: [
          {
            q: "Why might you prefer `git revert` over `git reset` on a shared branch?",
            options: ["Revert rewrites history", "Revert creates a new commit that undoes changes", "Reset is faster"],
            answer: 1,
          },
          {
            q: "What does `git reset --hard` do?",
            options: ["Only unstages files", "Moves HEAD and discards working changes", "Creates a merge commit"],
            answer: 1,
          },
          {
            q: "What is `git stash` for?",
            options: ["Saving changes temporarily without committing", "Deleting branches", "Viewing history"],
            answer: 0,
          },
        ],
      },
    },
  ];

  // -----------------------------
  // Achievements / badges
  // -----------------------------

  const BADGE_DEFS = [
    { id: "badge_first_init", label: "Initialized", desc: "Ran git init." },
    { id: "badge_first_commit", label: "First commit", desc: "Created your first commit." },
    { id: "badge_brancher", label: "Branching", desc: "Created a branch." },
    { id: "badge_merger", label: "Merged", desc: "Completed a merge." },
    { id: "badge_remote", label: "Remote ready", desc: "Pushed to origin." },
    { id: "badge_safety", label: "Safety net", desc: "Used stash/reset/revert." },
    { id: "badge_quiz_master", label: "Quiz master", desc: "Passed all quizzes." },
    ...LESSONS.map((l, idx) => ({
      id: `badge_complete_${l.id}`,
      label: `Lesson ${idx + 1}`,
      desc: `Completed: ${l.title}.`,
    })),
  ];

  function emptyBadgesState() {
    const out = {};
    for (const b of BADGE_DEFS) out[b.id] = { earned: false, earnedAt: null };
    return out;
  }

  // -----------------------------
  // App State (localStorage + export/import)
  // -----------------------------

  const STORAGE_KEY = "git_tutor_state_v1";

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("Failed to save state:", err);
    }
  }

  function defaultState() {
    return {
      version: 1,
      activeLessonId: LESSONS[0].id,
      lessons: {},
      badges: emptyBadgesState(),
      remoteStore: null,
    };
  }

  // -----------------------------
  // Rendering helpers
  // -----------------------------

  function renderHelp() {
    const el = qs("#helpContent");
    const byGroup = {};
    for (const c of COMMAND_DB) {
      if (!byGroup[c.group]) byGroup[c.group] = [];
      byGroup[c.group].push(c);
    }
    const groups = Object.keys(byGroup);
    el.innerHTML = groups
      .map((g) => {
        const rows = byGroup[g]
          .map(
            (c) =>
              `<div class="cmdRow"><div><code>${escapeHtml(c.cmd)}</code></div><div>${escapeHtml(c.desc)}</div></div>`
          )
          .join("");
        return `<h3 class="h3">${escapeHtml(g)}</h3>${rows}`;
      })
      .join("");
  }

  function setNotice(el, kind, text) {
    el.classList.remove("notice--ok", "notice--err");
    el.hidden = !text;
    if (!text) return;
    if (kind === "ok") el.classList.add("notice--ok");
    if (kind === "err") el.classList.add("notice--err");
    el.textContent = text;
  }

  // -----------------------------
  // Main App controller
  // -----------------------------

  class App {
    constructor() {
      this.remoteStore = new RemoteStore();
      this.seedRemoteUrl = "https://example.com/acme/widgets.git";

      this.state = defaultState();
      this.repo = new SimulatedRepo();

      this.history = [];
      this.historyIndex = 0;

      this.activeLesson = null;
      this.checkpoints = {}; // stepIndex -> serialized repo state (start of that step)
      this.stepIndex = 0;

      this.currentEditorPath = null;
      this.editorOriginalContent = "";

      // Lightweight UI animation: remember the last "interesting" HEAD so the graph can pop it in.
      this.animatedCommitHash = null;
      this.animatedCommitAt = 0;
    }

    init() {
      this.seedRemotes();

      const loaded = loadState();
      if (loaded && loaded.version === 1) {
        this.state = { ...defaultState(), ...loaded };
        if (loaded.remoteStore) this.remoteStore = RemoteStore.deserialize(loaded.remoteStore);
      }
      // Ensure new badges appear for older saved states.
      this.state.badges = { ...emptyBadgesState(), ...(this.state.badges || {}) };
      this.syncBadges({ silent: true });

      renderHelp();
      this.bindUi();
      this.renderLessonsNav();
      this.loadLesson(this.state.activeLessonId);
      this.renderAll();
      this.printWelcome();
    }

    ctx() {
      return {
        remoteStore: this.remoteStore,
        seedRemoteUrl: this.seedRemoteUrl,
        simulateTeammateCommitToOriginMain: (repo) => this.simulateTeammateCommitToOriginMain(repo),
      };
    }

    seedRemotes() {
      // Provide a small "public" remote for lessons 5/6 to clone from.
      const remote = this.remoteStore.ensureRepo(this.seedRemoteUrl);
      if (remote.commitOrder.length) return;

      const tmp = new SimulatedRepo();
      tmp.gitInit();
      tmp.workingFiles["/README.md"] = "# Acme Widgets\n\nWelcome!\n";
      tmp.gitAdd(["README.md"]);
      tmp.gitCommit(["-m", "Initial commit"]);
      tmp.workingFiles["/CONTRIBUTING.md"] = "Please open a PR.\n";
      tmp.gitAdd(["CONTRIBUTING.md"]);
      tmp.gitCommit(["-m", "Add contributing guide"]);

      remote.commits = deepCopy(tmp.commits);
      remote.commitOrder = [...tmp.commitOrder];
      remote.branches = { main: tmp.head };
    }

    bindUi() {
      qs("#btnHelp").addEventListener("click", () => {
        const panel = qs("#helpPanel");
        const isHidden = panel.hidden;
        panel.hidden = !isHidden;
        qs("#btnHelp").setAttribute("aria-expanded", String(isHidden));
        this.renderAll();
      });

      qs("#btnResetLesson").addEventListener("click", () => this.resetLesson());
      qs("#btnResetRepo").addEventListener("click", () => this.resetRepoToCheckpoint());

      qs("#btnExport").addEventListener("click", () => this.openStateModal("export"));
      qs("#btnImport").addEventListener("click", () => this.openStateModal("import"));
      qs("#btnCloseStateModal").addEventListener("click", () => this.closeModal("stateModal"));
      qs("#btnCopyState").addEventListener("click", () => this.copyState());
      qs("#btnPasteState").addEventListener("click", () => this.pasteState());
      qs("#btnApplyImport").addEventListener("click", () => this.applyImport());

      qs("#btnCloseEditor").addEventListener("click", () => this.closeModal("editorModal"));
      qs("#btnSaveFile").addEventListener("click", () => this.saveEditor());
      qs("#btnRevertFile").addEventListener("click", () => this.revertEditor());

      qs("#btnQuiz").addEventListener("click", () => this.openQuiz());
      qs("#btnCloseQuiz").addEventListener("click", () => this.closeModal("quizModal"));
      qs("#btnSubmitQuiz").addEventListener("click", () => this.submitQuiz());

      // Click outside modal card closes it.
      for (const id of ["stateModal", "editorModal", "quizModal"]) {
        const modal = qs(`#${id}`);
        modal.addEventListener("mousedown", (ev) => {
          if (ev.target === modal) this.closeModal(id);
        });
      }
      window.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") {
          this.closeModal("stateModal");
          this.closeModal("editorModal");
          this.closeModal("quizModal");
        }
      });

      const input = qs("#terminalInput");
      input.addEventListener("keydown", (ev) => this.onTerminalKeyDown(ev));
      input.addEventListener("input", () => this.renderSuggestion());
      input.addEventListener("focus", () => this.renderSuggestion());
    }

    printWelcome() {
      this.printLine("Git Tutor — interactive Git in your browser", "muted");
      this.printLine('Tip: type "help" for supported commands.', "muted");
      this.printLine("");
    }

    // -----------------------------
    // Lessons + persistence
    // -----------------------------

    getLessonState(lessonId) {
      if (!this.state.lessons[lessonId]) {
        this.state.lessons[lessonId] = {
          stepIndex: 0,
          completed: false,
          quiz: { taken: false, score: 0, passed: false, answers: [] },
          repo: null,
          checkpoints: {},
        };
      }
      return this.state.lessons[lessonId];
    }

    saveAppState() {
      // Persist currently active lesson state.
      if (this.activeLesson) {
        const lstate = this.getLessonState(this.activeLesson.id);
        lstate.stepIndex = this.stepIndex;
        lstate.repo = this.repo.serialize();
        lstate.checkpoints = deepCopy(this.checkpoints);
      }
      this.state.activeLessonId = this.activeLesson?.id || this.state.activeLessonId;
      this.state.remoteStore = this.remoteStore.serialize();
      saveState(this.state);
    }

    loadLesson(lessonId) {
      const lesson = LESSONS.find((l) => l.id === lessonId) || LESSONS[0];
      this.activeLesson = lesson;

      const lstate = this.getLessonState(lesson.id);

      // Restore from saved state when present; otherwise use lesson setup.
      if (lstate.repo) {
        this.repo = SimulatedRepo.deserialize(lstate.repo);
        this.checkpoints = lstate.checkpoints && typeof lstate.checkpoints === "object" ? lstate.checkpoints : {};
        this.stepIndex = typeof lstate.stepIndex === "number" ? lstate.stepIndex : 0;
      } else {
        this.repo = new SimulatedRepo();
        lesson.setup(this.repo, this.ctx());
        this.stepIndex = 0;
        this.checkpoints = { 0: this.repo.serialize() };
      }

      this.history = [];
      this.historyIndex = 0;
      qs("#terminalOutput").innerHTML = "";
      this.printLine(`Loaded: ${lesson.title}`, "muted");
      this.printLine("");

      this.renderLessonsNav();
      this.renderAll();
      this.saveAppState();
    }

    resetLesson() {
      if (!this.activeLesson) return;
      const lstate = this.getLessonState(this.activeLesson.id);
      lstate.stepIndex = 0;
      lstate.completed = false;
      lstate.quiz = { taken: false, score: 0, passed: false, answers: [] };
      lstate.repo = null;
      lstate.checkpoints = {};
      this.loadLesson(this.activeLesson.id);
    }

    resetRepoToCheckpoint() {
      const checkpoint = this.checkpoints[this.stepIndex];
      if (!checkpoint) {
        this.printLine("No checkpoint for this step; resetting lesson start.", "muted");
        this.resetLesson();
        return;
      }
      this.repo = SimulatedRepo.deserialize(checkpoint);
      this.printLine("Repo reset to the start of this step.", "muted");
      this.renderAll();
      this.saveAppState();
    }

    maybeCompleteStep(command, result) {
      if (!this.activeLesson) return;
      let advancedAny = false;
      while (true) {
        const step = this.activeLesson.steps[this.stepIndex];
        if (!step) break;
        const passed = !!step.validate({ command, repo: this.repo, result, app: this });
        if (!passed) break;

        advancedAny = true;

        const completedTitle = step.title;

        // Mark step done and create a new checkpoint for the next step.
        this.stepIndex += 1;
        this.checkpoints[this.stepIndex] = this.repo.serialize();
        this.printLine(`Completed: ${completedTitle}`, "ok");

        // Lesson-specific hooks (e.g. teammate remote commit after push).
        if (typeof this.activeLesson.onStepComplete === "function") {
          try {
            this.activeLesson.onStepComplete({
              stepIndex: this.stepIndex - 1,
              repo: this.repo,
              ctx: this.ctx(),
              app: this,
            });
          } catch (err) {
            console.warn("onStepComplete failed:", err);
          }
        }
      }

      if (!advancedAny) return;

      const lstate = this.getLessonState(this.activeLesson.id);
      if (this.stepIndex >= this.activeLesson.steps.length) {
        const wasCompleted = !!lstate.completed;
        lstate.completed = true;
        this.printLine("Lesson complete.", "ok");
        if (!wasCompleted) this.earnBadge(`badge_complete_${this.activeLesson.id}`);
      }
    }

    // -----------------------------
    // Terminal
    // -----------------------------

    onTerminalKeyDown(ev) {
      const input = qs("#terminalInput");
      if (ev.key === "Enter") {
        ev.preventDefault();
        const cmd = input.value.trim();
        input.value = "";
        qs("#terminalSuggestion").textContent = "";
        if (cmd) {
          this.history.push(cmd);
          this.historyIndex = this.history.length;
        }
        this.runCommand(cmd);
        return;
      }

      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (!this.history.length) return;
        this.historyIndex = clamp(this.historyIndex - 1, 0, this.history.length - 1);
        input.value = this.history[this.historyIndex] || "";
        this.renderSuggestion();
        return;
      }

      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (!this.history.length) return;
        this.historyIndex = clamp(this.historyIndex + 1, 0, this.history.length);
        input.value = this.historyIndex === this.history.length ? "" : this.history[this.historyIndex] || "";
        this.renderSuggestion();
        return;
      }

      if (ev.key === "Tab") {
        ev.preventDefault();
        const suggestion = this.getSuggestion(input.value);
        if (suggestion) {
          input.value = suggestion;
          this.renderSuggestion();
        }
        return;
      }

      if ((ev.ctrlKey || ev.metaKey) && (ev.key === "l" || ev.key === "L")) {
        ev.preventDefault();
        qs("#terminalOutput").innerHTML = "";
        this.printLine("Cleared.", "muted");
        return;
      }
    }

    renderSuggestion() {
      const input = qs("#terminalInput");
      const suggestion = this.getSuggestion(input.value);
      qs("#terminalSuggestion").textContent = suggestion ? `↳ ${suggestion}` : "";
    }

    getSuggestion(partial) {
      const text = String(partial || "").trimStart();
      if (!text) return "";

      const baseSuggestions = COMMAND_DB.map((c) => c.cmd.replaceAll("<file>|.", "README.md").replaceAll("<file>", "README.md"));
      const dynamic = [];

      // Suggest branches for checkout/merge.
      const tokens = splitArgs(text);
      if (tokens[0] === "git" && (tokens[1] === "checkout" || tokens[1] === "merge")) {
        const prefix = tokens[2] || "";
        for (const b of Object.keys(this.repo.branches).sort()) {
          if (b.startsWith(prefix)) dynamic.push(`git ${tokens[1]} ${b}`.trim());
        }
      }

      // Suggest file names for add/cat/edit.
      if (tokens[0] === "git" && tokens[1] === "add") {
        const prefix = tokens[2] || "";
        for (const p of Object.keys(this.repo.workingFiles).sort()) {
          const rel = this.repo.relPath(p);
          if (rel.startsWith(prefix)) dynamic.push(`git add ${rel}`);
        }
        dynamic.push("git add .");
      }
      if (["cat", "edit"].includes(tokens[0])) {
        const prefix = tokens[1] || "";
        for (const p of Object.keys(this.repo.workingFiles).sort()) {
          const rel = this.repo.relPath(p);
          if (rel.startsWith(prefix)) dynamic.push(`${tokens[0]} ${rel}`);
        }
      }

      const all = dynamic.concat(baseSuggestions);

      // Pick first suggestion that starts with input (case sensitive for simplicity).
      const best = all.find((s) => s.startsWith(text));
      return best && best !== text ? best : "";
    }

    printLine(text = "", kind = "") {
      const out = qs("#terminalOutput");
      const div = document.createElement("div");
      div.className = "terminal__line";
      if (kind === "cmd") div.classList.add("terminal__line--cmd");
      if (kind === "ok") div.classList.add("terminal__line--ok");
      if (kind === "err") div.classList.add("terminal__line--err");
      if (kind === "muted") div.classList.add("terminal__line--muted");
      div.textContent = text;
      out.appendChild(div);
      out.scrollTop = out.scrollHeight;
    }

    runCommand(command) {
      const cmd = String(command || "").trim();
      if (!cmd) return;

      this.printLine(`${this.prompt()} ${cmd}`, "cmd");

      const beforeHead = this.repo.head;

      // Built-in UI commands.
      if (cmd === "clear") {
        qs("#terminalOutput").innerHTML = "";
        this.printLine("Cleared.", "muted");
        return;
      }
      if (cmd === "help") {
        this.printLine("Supported commands are listed in the Help panel (top right).", "muted");
        this.printLine('Try: git init • git status • git add . • git commit -m "msg"', "muted");
        return;
      }

      // Open in-app editor: edit <file>
      if (cmd.startsWith("edit ")) {
        const path = joinPath(this.repo.cwd, cmd.slice("edit ".length).trim());
        if (!Object.prototype.hasOwnProperty.call(this.repo.workingFiles, path)) {
          this.printLine(`edit: no such file: ${this.repo.relPath(path)}`, "err");
          return;
        }
        this.openEditor(path);
        this.printLine(`Opened editor for ${this.repo.relPath(path)}.`, "muted");
        return;
      }

      const result = this.exec(cmd);

      // Trigger a small animation when history moves forward/back (commit, merge, pull, reset, revert).
      const afterHead = this.repo.head;
      const eventType = this.repo.lastEvent?.type || "";
      const animEvents = new Set([
        "git_commit",
        "git_merge",
        "git_pull_ff",
        "git_pull_merge",
        "git_reset_hard",
        "git_revert",
      ]);
      if (afterHead && afterHead !== beforeHead && animEvents.has(eventType)) {
        this.animatedCommitHash = afterHead;
        this.animatedCommitAt = nowMs();
      }

      for (const line of asArray(result.stdout)) if (line !== undefined) this.printLine(line, result.ok ? "" : "");
      for (const line of asArray(result.stderr)) if (line !== undefined) this.printLine(line, "err");

      this.maybeCompleteStep(cmd, result);
      this.evaluateBadges();
      this.renderAll();
      this.saveAppState();
    }

    prompt() {
      const status = this.repo.getStatus();
      if (!status.initialized) return "$";
      return `${this.repo.relPath(this.repo.cwd) || "/"} (${status.branch})$`;
    }

    exec(cmd) {
      const ctx = this.ctx();

      if (cmd.startsWith("git ")) return this.repo.runGit(cmd, ctx);
      return this.repo.runShell(cmd, ctx);
    }

    // -----------------------------
    // Editor modal
    // -----------------------------

    openEditor(absPath) {
      this.currentEditorPath = absPath;
      this.editorOriginalContent = this.repo.workingFiles[absPath] || "";
      qs("#editorPath").textContent = this.repo.relPath(absPath);
      qs("#editorTitle").textContent = `Edit ${this.repo.relPath(absPath)}`;
      qs("#editorTextarea").value = this.editorOriginalContent;
      setNotice(qs("#editorNotice"), "", "");
      this.openModal("editorModal");
      qs("#editorTextarea").focus();
    }

    saveEditor() {
      if (!this.currentEditorPath) return;
      const value = qs("#editorTextarea").value;
      this.repo.workingFiles[this.currentEditorPath] = value;
      setNotice(qs("#editorNotice"), "ok", "Saved.");
      this.repo.lastEvent = { type: "fs_edit", path: this.repo.relPath(this.currentEditorPath) };
      this.renderAll();
      this.saveAppState();
    }

    revertEditor() {
      if (!this.currentEditorPath) return;
      qs("#editorTextarea").value = this.editorOriginalContent;
      setNotice(qs("#editorNotice"), "ok", "Reverted editor buffer to the original content.");
    }

    // -----------------------------
    // Export / Import
    // -----------------------------

    openStateModal(mode) {
      setNotice(qs("#stateModalNotice"), "", "");
      const textarea = qs("#stateTextarea");
      if (mode === "export") {
        textarea.value = JSON.stringify(this.exportState(), null, 2);
        textarea.focus();
        textarea.select();
      } else {
        textarea.value = "";
        textarea.focus();
      }
      this.openModal("stateModal");
    }

    exportState() {
      // Make sure current lesson repo is included.
      this.saveAppState();
      return deepCopy(this.state);
    }

    async copyState() {
      try {
        await navigator.clipboard.writeText(qs("#stateTextarea").value);
        setNotice(qs("#stateModalNotice"), "ok", "Copied to clipboard.");
      } catch {
        setNotice(qs("#stateModalNotice"), "err", "Clipboard copy failed. Select text and copy manually.");
      }
    }

    async pasteState() {
      try {
        const text = await navigator.clipboard.readText();
        qs("#stateTextarea").value = text;
        setNotice(qs("#stateModalNotice"), "ok", "Pasted from clipboard.");
      } catch {
        setNotice(qs("#stateModalNotice"), "err", "Clipboard paste failed. Paste manually.");
      }
    }

    applyImport() {
      const raw = qs("#stateTextarea").value.trim();
      if (!raw) return setNotice(qs("#stateModalNotice"), "err", "Nothing to import.");
      try {
        const imported = JSON.parse(raw);
        if (!imported || imported.version !== 1) throw new Error("Unsupported export format.");
        this.state = { ...defaultState(), ...imported };
        this.remoteStore = imported.remoteStore ? RemoteStore.deserialize(imported.remoteStore) : new RemoteStore();
        this.loadLesson(this.state.activeLessonId);
        setNotice(qs("#stateModalNotice"), "ok", "Imported.");
      } catch (err) {
        setNotice(qs("#stateModalNotice"), "err", `Import failed: ${err.message}`);
      }
    }

    // -----------------------------
    // Quiz modal
    // -----------------------------

    openQuiz() {
      if (!this.activeLesson) return;
      const quiz = this.activeLesson.quiz;
      if (!quiz) return;

      const lstate = this.getLessonState(this.activeLesson.id);
      const body = qs("#quizBody");
      body.innerHTML = quiz.questions
        .map((q, i) => {
          const selected = lstate.quiz.answers?.[i];
          const opts = q.options
            .map((o, idx) => {
              const checked = selected === idx ? "checked" : "";
              return `<label class="quizOpt"><input type="radio" name="q${i}" value="${idx}" ${checked} /> ${escapeHtml(
                o
              )}</label>`;
            })
            .join("");
          return `<div class="quizQ"><div class="quizQ__q">${escapeHtml(q.q)}</div><div class="quizQ__opts">${opts}</div></div>`;
        })
        .join("");

      qs("#quizTitle").textContent = quiz.title || "Quiz";
      setNotice(qs("#quizNotice"), "", "");
      this.openModal("quizModal");
    }

    submitQuiz() {
      if (!this.activeLesson?.quiz) return;
      const quiz = this.activeLesson.quiz;
      const answers = [];
      for (let i = 0; i < quiz.questions.length; i++) {
        const checked = qs(`input[name="q${i}"]:checked`);
        answers[i] = checked ? Number(checked.value) : null;
      }

      let correct = 0;
      for (let i = 0; i < quiz.questions.length; i++) {
        if (answers[i] === quiz.questions[i].answer) correct += 1;
      }
      const score = Math.round((correct / quiz.questions.length) * 100);
      const passed = score >= 70;

      const lstate = this.getLessonState(this.activeLesson.id);
      lstate.quiz = { taken: true, score, passed, answers };

      setNotice(qs("#quizNotice"), passed ? "ok" : "err", `${passed ? "Passed" : "Not passed"} — score: ${score}%`);
      this.evaluateBadges();
      this.renderAll();
      this.saveAppState();
    }

    // -----------------------------
    // Modals (simple)
    // -----------------------------

    openModal(id) {
      const el = qs(`#${id}`);
      if (!el) return;
      el.hidden = false;
      el.dataset.open = "true";
      document.body.style.overflow = "hidden";
    }

    closeModal(id) {
      const el = qs(`#${id}`);
      if (!el || el.hidden) return;
      el.hidden = true;
      el.dataset.open = "false";
      document.body.style.overflow = "";

      if (id === "editorModal") {
        this.currentEditorPath = null;
        this.editorOriginalContent = "";
      }
    }

    // -----------------------------
    // Badge evaluation
    // -----------------------------

    earnBadge(id, options = {}) {
      const b = this.state.badges[id];
      if (!b || b.earned) return false;
      b.earned = true;
      b.earnedAt = nowMs();
      if (!options.silent) {
        this.printLine(`Achievement unlocked: ${BADGE_DEFS.find((x) => x.id === id)?.label || id}`, "ok");
      }
      return true;
    }

    syncBadges(options = {}) {
      // Completion badges.
      for (const lesson of LESSONS) {
        if (this.getLessonState(lesson.id).completed) this.earnBadge(`badge_complete_${lesson.id}`, options);
      }
      // Quiz master: all quizzes passed.
      const allPassed = LESSONS.every((l) => {
        const ls = this.getLessonState(l.id);
        return !!ls.quiz?.passed;
      });
      if (allPassed) this.earnBadge("badge_quiz_master", options);
    }

    evaluateBadges() {
      const ev = this.repo.lastEvent;
      if (!ev) return;

      if (ev.type === "git_init") this.earnBadge("badge_first_init");
      if (ev.type === "git_commit") this.earnBadge("badge_first_commit");
      if (ev.type === "git_branch_create") this.earnBadge("badge_brancher");
      if (ev.type === "git_merge") this.earnBadge("badge_merger");
      if (ev.type === "git_push") this.earnBadge("badge_remote");
      if (["git_stash", "git_reset_hard", "git_revert"].includes(ev.type)) this.earnBadge("badge_safety");

      this.syncBadges();
    }

    // -----------------------------
    // Remote simulation helpers
    // -----------------------------

    simulateTeammateCommitToOriginMain(repo) {
      const origin = repo.remotes.origin;
      if (!origin) return;
      const remoteRepo = this.remoteStore.ensureRepo(origin.url);
      const headHash = remoteRepo.branches.main;
      const headCommit = remoteRepo.commits[headHash];
      const baseFiles = deepCopy(headCommit?.files || {});
      baseFiles["/README.md"] = (baseFiles["/README.md"] || "# Acme Widgets\n") + "\n## Teammate update\nPulled from origin.\n";

      // Create commit directly in remote repo.
      const hash = repo.genHash();
      remoteRepo.commits[hash] = {
        hash,
        message: "Teammate: update README",
        parents: headHash ? [headHash] : [],
        timestamp: nowMs(),
        files: baseFiles,
        lane: 0,
        branch: "main",
      };
      remoteRepo.commitOrder.push(hash);
      remoteRepo.branches.main = hash;
    }

    // -----------------------------
    // Rendering
    // -----------------------------

    renderLessonsNav() {
      const nav = qs("#lessonList");
      nav.innerHTML = "";
      for (const lesson of LESSONS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "lessonBtn";
        btn.setAttribute("aria-current", String(this.activeLesson?.id === lesson.id));

        const left = document.createElement("div");
        left.className = "lessonBtn__left";
        const title = document.createElement("div");
        title.className = "lessonBtn__title";
        title.textContent = lesson.title;
        const desc = document.createElement("div");
        desc.className = "lessonBtn__desc";
        desc.textContent = lesson.short;
        left.appendChild(title);
        left.appendChild(desc);

        const right = document.createElement("div");
        right.className = "lessonBtn__right";
        const lstate = this.getLessonState(lesson.id);
        const tag = document.createElement("span");
        tag.className = "pill pill--muted";
        const total = lesson.steps.length;
        tag.textContent = lstate.completed ? "Done" : `${Math.min(lstate.stepIndex, total)}/${total}`;
        right.appendChild(tag);

        btn.appendChild(left);
        btn.appendChild(right);
        btn.addEventListener("click", () => this.loadLesson(lesson.id));
        nav.appendChild(btn);
      }
    }

    renderInstructions() {
      const lesson = this.activeLesson;
      if (!lesson) return;

      qs("#lessonTitle").textContent = lesson.title;
      qs("#lessonIntro").innerHTML = lesson.introHtml;

      const total = lesson.steps.length;
      const current = clamp(this.stepIndex, 0, total);
      qs("#stepMeta").textContent = `${current + 1 <= total ? `${current + 1}/${total}` : `${total}/${total}`} steps`;

      const step = lesson.steps[this.stepIndex];
      qs("#stepText").innerHTML = step ? step.text : "All steps complete — take the quiz to finish.";
      const hintEl = qs("#stepHint");
      if (step?.hint) {
        hintEl.hidden = false;
        hintEl.innerHTML = step.hint;
      } else {
        hintEl.hidden = true;
        hintEl.textContent = "";
      }

      const list = qs("#stepList");
      list.innerHTML = "";
      for (let i = 0; i < lesson.steps.length; i++) {
        const li = document.createElement("li");
        li.innerHTML = `${lesson.steps[i].title}`;
        if (i < this.stepIndex) li.classList.add("done");
        list.appendChild(li);
      }

      // Quiz button enabled when lesson completed.
      const lstate = this.getLessonState(lesson.id);
      qs("#btnQuiz").disabled = !lstate.completed;
    }

    renderProgress() {
      const completed = LESSONS.filter((l) => this.getLessonState(l.id).completed).length;
      qs("#progressText").textContent = `${completed}/${LESSONS.length} lessons`;
      qs("#progressBarFill").style.width = `${(completed / LESSONS.length) * 100}%`;

      const earned = Object.values(this.state.badges).filter((b) => b.earned).length;
      qs("#badgeCount").textContent = `${earned} badges`;
    }

    renderBadges() {
      const el = qs("#badges");
      el.innerHTML = "";
      for (const def of BADGE_DEFS) {
        const b = this.state.badges[def.id];
        const div = document.createElement("div");
        div.className = "badge" + (b?.earned ? " badge--earned" : "");
        div.title = def.desc;
        div.innerHTML = `<span class="badge__dot" aria-hidden="true"></span><span>${escapeHtml(def.label)}</span>`;
        el.appendChild(div);
      }
    }

    renderStatusPills() {
      const status = this.repo.getStatus();
      qs("#terminalPrompt").textContent = this.prompt();
      qs("#pillRepoState").textContent = status.initialized ? "Repo" : "No repo";
      qs("#pillBranch").textContent = status.initialized ? status.branch : "—";
      qs("#pillCwd").textContent = this.repo.cwd;
    }

    renderFileTree() {
      const container = qs("#fileTree");
      const status = this.repo.getStatus();
      const conflicts = new Set(status.conflicts);
      const staged = new Set(Object.keys(this.repo.stagedFiles));

      const headSnap = this.repo.getHeadSnapshot();
      const allPaths = this.repo.listAllPaths();

      // Build directory tree.
      const root = { name: "/", path: "/", type: "dir", children: new Map() };
      const addNode = (absPath) => {
        const rel = this.repo.relPath(absPath);
        const parts = rel === "/" ? [] : rel.split("/");
        let cur = root;
        let running = "";
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          running += "/" + part;
          const isLast = i === parts.length - 1;
          const type = isLast ? "file" : "dir";
          if (!cur.children.has(part)) cur.children.set(part, { name: part, path: running, type, children: new Map() });
          cur = cur.children.get(part);
          cur.type = type; // in case a dir becomes file (won't happen, but safe)
        }
      };

      // Include explicit empty directories.
      for (const dir of Object.keys(this.repo.directories)) {
        if (dir === "/") continue;
        addNode(dir);
      }
      for (const p of allPaths) addNode(p);

      const entries = [];
      const walk = (node, depth) => {
        const children = [...node.children.values()].sort((a, b) => {
          if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        for (const child of children) {
          entries.push({ node: child, depth });
          if (child.type === "dir") walk(child, depth + 1);
        }
      };
      walk(root, 0);

      container.innerHTML = "";

      for (const { node, depth } of entries) {
        const row = document.createElement("div");
        row.className = "fileNode";
        row.style.paddingLeft = `${8 + depth * 14}px`;

        if (node.type === "dir") {
          row.innerHTML = `<span class="fileNode__status" aria-hidden="true">▸</span><span class="fileNode__name">${escapeHtml(
            node.name
          )}</span>`;
          container.appendChild(row);
          continue;
        }

        const absPath = normalizePath(node.path);
        const workHas = Object.prototype.hasOwnProperty.call(this.repo.workingFiles, absPath);
        const headHas = Object.prototype.hasOwnProperty.call(headSnap, absPath);
        const isConflict = conflicts.has(absPath);
        const isStaged = staged.has(absPath);

        let code = "";
        if (isConflict) code = "C";
        else if (!headHas && workHas) code = "A";
        else if (headHas && !workHas) code = "D";
        else if (headHas && workHas && this.repo.workingFiles[absPath] !== headSnap[absPath]) code = "M";

        const statusHtml = code
          ? `<span class="fileNode__status fileNode__status--${code}" aria-hidden="true">${code}</span>`
          : `<span class="fileNode__status" aria-hidden="true">•</span>`;

        const badges = [];
        if (isStaged) badges.push(`<span class="fileNode__badge fileNode__badge--stage">staged</span>`);
        if (isConflict) badges.push(`<span class="fileNode__badge fileNode__badge--conflict">conflict</span>`);

        row.innerHTML = `${statusHtml}<span class="fileNode__name">${escapeHtml(node.name)}</span>${badges.join("")}`;
        row.addEventListener("click", () => {
          if (!workHas) {
            this.printLine(`Cannot edit deleted file: ${this.repo.relPath(absPath)}`, "err");
            return;
          }
          this.openEditor(absPath);
        });
        container.appendChild(row);
      }
    }

    renderGraph() {
      const svg = qs("#gitGraph");
      const legend = qs("#branchLegend");
      const meta = qs("#graphMeta");

      const status = this.repo.getStatus();
      if (!status.initialized || !this.repo.commitOrder.length) {
        svg.innerHTML = "";
        legend.innerHTML = "";
        meta.textContent = status.initialized ? "No commits yet" : "No repository";
        return;
      }

      // Compute commit coordinates. Newest at top.
      const hashes = [...this.repo.commitOrder].reverse();
      const lanes = Math.max(
        1,
        ...Object.values(this.repo.branchMeta).map((m) => (typeof m.lane === "number" ? m.lane + 1 : 1))
      );

      const laneWidth = 120;
      const rowHeight = 64;
      const paddingX = 60;
      const paddingY = 46;
      const width = paddingX * 2 + laneWidth * Math.max(1, lanes - 1) + 220;
      const height = paddingY * 2 + rowHeight * hashes.length;

      const pos = {};
      hashes.forEach((hash, i) => {
        const c = this.repo.commits[hash];
        const lane = typeof c?.lane === "number" ? c.lane : 0;
        pos[hash] = { x: paddingX + lane * laneWidth, y: paddingY + i * rowHeight };
      });

      const animatedHash =
        this.animatedCommitHash && nowMs() - this.animatedCommitAt < 900 ? this.animatedCommitHash : null;

      // SVG helpers
      const edgePaths = [];
      const nodeEls = [];

      for (const hash of hashes) {
        const c = this.repo.commits[hash];
        if (!c) continue;
        const { x, y } = pos[hash];
        const parents = c.parents || [];
        for (const parent of parents) {
          if (!pos[parent]) continue;
          const p = pos[parent];
          const midY = (y + p.y) / 2;
          edgePaths.push(
            `<path d="M ${x} ${y} C ${x} ${midY}, ${p.x} ${midY}, ${p.x} ${p.y}" stroke="rgba(255,255,255,0.25)" stroke-width="3" fill="none" />`
          );
        }

        const color = this.repo.branchMeta[c.branch]?.color || BRANCH_COLORS[0];
        const isHead = hash === this.repo.head;
        const radius = isHead ? 9 : 7;
        const popClass = animatedHash === hash ? "pop" : "";

        const label = `${shortHash(c.hash)} — ${c.message}`;
        nodeEls.push(
          `<g class="node" data-hash="${escapeHtml(hash)}">
            <circle class="${popClass}" cx="${x}" cy="${y}" r="${radius}" fill="${escapeHtml(
              color
            )}" stroke="rgba(0,0,0,0.45)" stroke-width="3" />
            <text x="${x + 18}" y="${y + 5}" fill="rgba(255,255,255,0.82)" font-size="12" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace">${escapeHtml(
              label
            )}</text>
          </g>`
        );
      }

      // Branch labels near their heads.
      const branchLabels = [];
      for (const [branch, head] of Object.entries(this.repo.branches)) {
        if (!head || !pos[head]) continue;
        if (branch.startsWith("__remote_")) continue;
        const { x, y } = pos[head];
        const color = this.repo.branchMeta[branch]?.color || "rgba(255,255,255,0.5)";
        branchLabels.push(
          `<g>
            <rect x="${x - 10}" y="${y - 26}" rx="10" ry="10" width="${Math.max(
              70,
              18 + branch.length * 7
            )}" height="20" fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.16)"></rect>
            <circle cx="${x}" cy="${y - 16}" r="4" fill="${escapeHtml(color)}"></circle>
            <text x="${x + 10}" y="${y - 11}" fill="rgba(255,255,255,0.78)" font-size="11" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace">${escapeHtml(
              branch
            )}</text>
          </g>`
        );
      }

      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.innerHTML = `<rect x="0" y="0" width="${width}" height="${height}" fill="rgba(0,0,0,0)" />
        ${edgePaths.join("")}
        ${nodeEls.join("")}
        ${branchLabels.join("")}
      `;

      // Hover updates the graph meta line.
      svg.querySelectorAll(".node").forEach((node) => {
        node.addEventListener("mouseenter", () => {
          const hash = node.getAttribute("data-hash");
          const c = this.repo.commits[hash];
          if (!c) return;
          meta.textContent = `${shortHash(c.hash)} • ${c.message} • ${new Date(c.timestamp).toLocaleString()}`;
        });
      });
      svg.addEventListener("mouseleave", () => {
        meta.textContent = `${plural(this.repo.commitOrder.length, "commit")} • branch: ${this.repo.currentBranch}`;
      });

      meta.textContent = `${plural(this.repo.commitOrder.length, "commit")} • branch: ${this.repo.currentBranch}`;

      // Legend
      legend.innerHTML = "";
      for (const b of Object.keys(this.repo.branches).sort()) {
        if (b.startsWith("__remote_")) continue;
        const item = document.createElement("div");
        item.className = "legendItem";
        const sw = document.createElement("span");
        sw.className = "legendSwatch";
        sw.style.background = this.repo.branchMeta[b]?.color || "rgba(255,255,255,0.3)";
        const label = document.createElement("span");
        label.textContent = `${b} @ ${shortHash(this.repo.branches[b])}`;
        item.appendChild(sw);
        item.appendChild(label);
        legend.appendChild(item);
      }
    }

    renderAll() {
      this.renderInstructions();
      this.renderProgress();
      this.renderBadges();
      this.renderStatusPills();
      this.renderFileTree();
      this.renderGraph();
      this.renderSuggestion();
    }
  }

  // Boot
  window.addEventListener("DOMContentLoaded", () => {
    const app = new App();
    app.init();
  });
})();
