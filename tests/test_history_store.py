"""Exercise real Git operations against disposable local remotes only."""
import json
import os
import subprocess

import pytest

import history_store


def git(*args, cwd=None):
    return subprocess.run(
        ["git", *args], cwd=cwd, encoding="utf-8", capture_output=True, check=True
    ).stdout.strip()


@pytest.fixture
def repository(tmp_path, monkeypatch):
    # Isolate test identity and hooks from any machine-level Git configuration.
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    for role in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{role}_NAME", "History test")
        monkeypatch.setenv(f"GIT_{role}_EMAIL", "history@example.invalid")
    remote = tmp_path / "remote.git"
    checkout = tmp_path / "checkout"
    git("init", "--bare", "--initial-branch=main", str(remote))
    git("clone", remote.as_uri(), str(checkout))
    (checkout / "README.md").write_text("source stays on main\n")
    git("add", "README.md", cwd=checkout)
    git("commit", "-m", "Initial source", cwd=checkout)
    git("push", "origin", "main", cwd=checkout)
    monkeypatch.chdir(checkout)
    return checkout, remote


def write_history(label):
    history_store.HISTORY.parent.mkdir(exist_ok=True)
    contents = json.dumps({"checks": [], "label": label}, ensure_ascii=False)
    history_store.HISTORY.write_text(contents, encoding="utf-8")
    return contents


def test_first_run_and_restore_into_fresh_checkout(repository, tmp_path, monkeypatch):
    checkout, remote = repository
    assert history_store.restore() is False
    assert not history_store.HISTORY.exists()
    expected = write_history("Проверка истории 🦆")
    # Even staged source edits must not leak into the data branch.
    (checkout / "README.md").write_text("local source edit\n")
    git("add", "README.md")
    before = git("status", "--porcelain")
    main = git("rev-parse", "HEAD")
    history_store.save()
    assert git("status", "--porcelain") == before
    assert git("rev-parse", "HEAD") == main
    assert git("ls-tree", "--name-only", history_store.REMOTE_REF) == "history.json"

    fresh = tmp_path / "fresh"
    git("clone", "--depth=1", remote.as_uri(), str(fresh))
    monkeypatch.chdir(fresh)
    assert history_store.restore() is True
    assert history_store.HISTORY.read_text(encoding="utf-8") == expected
    first = git("rev-parse", history_store.REMOTE_REF)
    write_history("second")
    history_store.save()
    assert git("rev-parse", f"{history_store.REMOTE_REF}^") == first


def test_unreachable_remote_is_not_treated_as_empty_history(repository, tmp_path):
    expected = write_history("keep me")
    git("remote", "set-url", "origin", (tmp_path / "missing.git").as_uri())
    with pytest.raises(subprocess.CalledProcessError):
        history_store.restore()
    assert history_store.HISTORY.read_text(encoding="utf-8") == expected


def test_missing_history_file_on_existing_branch_fails(repository):
    git("push", "origin", f"HEAD:{history_store.BRANCH}")
    expected = write_history("keep me")
    with pytest.raises(subprocess.CalledProcessError):
        history_store.restore()
    assert history_store.HISTORY.read_text(encoding="utf-8") == expected


def test_concurrent_writer_cannot_overwrite_newer_history(repository, tmp_path, monkeypatch):
    checkout, remote = repository
    write_history("first")
    history_store.save()
    second = tmp_path / "second"
    git("clone", "--depth=1", remote.as_uri(), str(second))
    with monkeypatch.context() as other:
        other.chdir(second)
        assert history_store.restore() is True

    expected = write_history("newer")
    history_store.save()
    with monkeypatch.context() as other:
        other.chdir(second)
        write_history("stale")
        with pytest.raises(subprocess.CalledProcessError):
            history_store.save()

    assert history_store.restore() is True
    assert history_store.HISTORY.read_text(encoding="utf-8") == expected
