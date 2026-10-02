"""Restore/save Pages history in a data-only branch, without changing the checkout."""
import argparse
import subprocess
from pathlib import Path

BRANCH = "refs/heads/site-watch-history"
REMOTE_REF = "refs/remotes/origin/site-watch-history"
HISTORY = Path("docs/history.json")


def git(*args: str, input: str | None = None) -> subprocess.CompletedProcess:
    # Git's input protocol requires LF even when Python runs on Windows.
    result = subprocess.run(
        ["git", *args],
        input=input.encode("utf-8") if input is not None else None,
        stdout=subprocess.PIPE,
        check=True,
    )
    return subprocess.CompletedProcess(
        result.args, result.returncode, result.stdout.decode("utf-8")
    )


def restore() -> bool:
    """Only a missing branch is a first run; access/network errors must fail."""
    result = subprocess.run(
        ["git", "ls-remote", "--exit-code", "--heads", "origin", BRANCH],
        encoding="utf-8", stdout=subprocess.PIPE,
    )
    if result.returncode == 2:
        return False
    result.check_returncode()
    git("fetch", "--no-tags", "--depth=1", "origin", f"{BRANCH}:{REMOTE_REF}")
    contents = git("show", f"{REMOTE_REF}:history.json").stdout
    HISTORY.parent.mkdir(parents=True, exist_ok=True)
    HISTORY.write_text(contents, encoding="utf-8")
    return True


def save() -> None:
    """Append a data commit. A concurrent writer is rejected, never overwritten."""
    # Build a one-file tree; don't stage source files or change the working branch.
    blob = git("hash-object", "-w", str(HISTORY)).stdout.strip()
    tree = git("mktree", input=f"100644 blob {blob}\thistory.json\n").stdout.strip()
    parent = subprocess.run(
        ["git", "rev-parse", "--verify", "--quiet", REMOTE_REF],
        encoding="utf-8", stdout=subprocess.PIPE,
    )
    if parent.returncode not in (0, 1):
        parent.check_returncode()
    parents = ["-p", parent.stdout.strip()] if parent.returncode == 0 else []
    commit = git(
        "commit-tree", tree, *parents, input="Save scheduled check history\n"
    ).stdout.strip()
    git("push", "origin", f"{commit}:{BRANCH}")
    # A shallow, single-branch checkout may not track this ref automatically.
    git("update-ref", REMOTE_REF, commit)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("restore", "save"))
    action = parser.parse_args().action
    if action == "restore":
        print(f"restored={str(restore()).lower()}")
    else:
        save()
