const { execFileSync } = require("node:child_process");

function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function readGitMetadata(cwd = process.cwd()) {
  const repoRoot = git(["rev-parse", "--show-toplevel"], cwd);

  if (!repoRoot) {
    return {
      repoPath: "",
      remoteUrl: "",
      branch: "",
      commitSha: "",
      dirty: false,
    };
  }

  const status = git(["status", "--porcelain"], repoRoot);

  return {
    repoPath: repoRoot,
    remoteUrl: git(["remote", "get-url", "origin"], repoRoot),
    branch: git(["branch", "--show-current"], repoRoot),
    commitSha: git(["rev-parse", "HEAD"], repoRoot),
    dirty: status.length > 0,
  };
}

module.exports = {
  readGitMetadata,
};

