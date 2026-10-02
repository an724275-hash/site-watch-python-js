from pathlib import Path

import yaml


WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/pages.yml"


def test_deployment_has_no_repository_write_permission():
    workflow = yaml.load(WORKFLOW.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
    collect = workflow["jobs"]["collect"]
    deploy = workflow["jobs"]["deploy"]
    assert workflow["permissions"] == {"contents": "read"}
    assert collect["permissions"] == {"contents": "write"}
    assert deploy["permissions"] == {"pages": "write", "id-token": "write"}
    assert collect["environment"]["name"] == "github-pages"
    assert deploy["environment"]["name"] == "github-pages"
    assert deploy["needs"] == "collect"
    assert workflow["concurrency"]["cancel-in-progress"] == "false"
    assert workflow["on"]["push"]["branches"] == ["main"]


def test_history_is_saved_before_the_deploy_artifact_is_uploaded():
    workflow = yaml.load(WORKFLOW.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
    steps = workflow["jobs"]["collect"]["steps"]
    restore = next(i for i, step in enumerate(steps) if "history_store.py restore" in step.get("run", ""))
    build = next(i for i, step in enumerate(steps) if step.get("run") == "python build_pages.py")
    save = next(i for i, step in enumerate(steps) if step.get("run") == "python history_store.py save")
    upload = next(i for i, step in enumerate(steps) if step.get("uses", "").startswith("actions/upload-pages-artifact@"))
    assert restore < build < save < upload
    assert not any(step.get("uses", "").startswith("actions/deploy-pages@") for step in steps)
    cache = next(step for step in steps if step.get("uses", "").startswith("actions/cache/restore@"))
    assert cache["if"] == "steps.history.outputs.restored == 'false'"
