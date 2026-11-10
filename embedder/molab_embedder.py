import marimo

__generated_with = "0.25.2"
app = marimo.App(width="medium")


@app.cell
def _():
    # marimo's `mo` only exists once a cell imports it, and the title cell is first.
    import marimo as mo
    mo.md(r"""
    # Shopmate embedder on molab

    Runs the `shopmate_embedder` FastAPI app (`POST /search`, `GET /health`) on this GPU box
    and exposes it through a Cloudflare quick tunnel.

    1. Set the secrets as molab environment variables, then run the cells top to bottom.
    2. The first run clones the repo and downloads ~1.5 GB of model weights (10+ min).
    3. The `trycloudflare.com` URL changes on every tunnel restart: copy the new
       `EMBEDDER_URL` into the web app each time.
    4. Re-running the API cell also restarts the tunnel, so `EMBEDDER_URL` changes again.
    """)
    return (mo,)


@app.cell
def _():
    import base64
    import json
    import os
    import re
    import shutil
    import signal
    import statistics
    import subprocess
    import sys
    import time
    import urllib.error
    import urllib.request
    from pathlib import Path

    def run(cmd, *, env=None, cwd=None, check=True, redact=()):
        """Run a command; on failure raise with the program name and a redacted tail."""
        proc = subprocess.run(cmd, check=False, capture_output=True, text=True, env=env, cwd=cwd)
        if check and proc.returncode != 0:
            tail = "\n".join((proc.stdout + proc.stderr).splitlines()[-40:])
            for secret in redact:
                if secret:
                    tail = tail.replace(secret, "***")
            raise RuntimeError(f"{Path(cmd[0]).name} failed (exit {proc.returncode}):\n{tail}")
        return proc.stdout

    def log_tail(path, lines=40):
        """Last `lines` lines of a log file, or a placeholder when it does not exist."""
        log = Path(path)
        if not log.exists():
            return "(no log yet)"
        return "\n".join(log.read_text(errors="replace").splitlines()[-lines:])

    def stop_pid(pid_file, expect, grace=5.0):
        """SIGTERM, then SIGKILL after `grace`, but only for a matching process; pid files
        persist across molab restarts while pids get recycled, so check /proc cmdline."""
        pid_path = Path(pid_file)
        if not pid_path.exists():
            return None
        try:
            pid = int(pid_path.read_text().strip())
        except ValueError:
            pid_path.unlink(missing_ok=True)
            return None
        try:
            _cmdline = (Path("/proc") / str(pid) / "cmdline").read_text(errors="replace")
        except OSError:
            _cmdline = ""
        if expect not in _cmdline:
            pid_path.unlink(missing_ok=True)
            return None
        for sig, wait in ((signal.SIGTERM, grace), (signal.SIGKILL, 0.0)):
            try:
                os.kill(pid, sig)
            except ProcessLookupError:
                break
            deadline = time.monotonic() + wait
            while time.monotonic() < deadline:
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.2)
        pid_path.unlink(missing_ok=True)
        return pid

    def terminate(proc):
        """SIGTERM a Popen and wait; SIGKILL if it is still alive after 10 s."""
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()

    return (Path, base64, json, log_tail, os, re, run, shutil, statistics, stop_pid,
            subprocess, sys, terminate, time, urllib)


@app.cell
def _(Path, mo, os):
    REPO = "https://github.com/Eboiz/shopmate.git"
    BRANCH = "feat/pb-30-customer-photos"
    WORK = Path("/marimo/shopmate")
    VENV = Path("/marimo/work/embedder-venv")
    BIN = Path("/marimo/work/bin")
    LOGS = Path("/marimo/work/logs")
    HF_HOME = "/marimo/work/hf-cache"
    PORT = 8008
    SHOPS_TO_INDEX: list[str] = []  # e.g. ["hanh-boutique"]; only used when RUN_INDEX is True
    RUN_INDEX = False
    SMOKE_SHOP = "hanh-boutique"
    for _dir in (LOGS, BIN, Path(HF_HOME)):
        _dir.mkdir(parents=True, exist_ok=True)

    # Secrets live in molab environment variables only; values are never displayed.
    GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
    HF_TOKEN = os.environ.get("HF_TOKEN", "")
    QDRANT_URL = os.environ.get("QDRANT_URL", "")
    QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", "")
    QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION") or "shopmate_products_dev"
    EMBEDDER_TOKEN = os.environ.get("EMBEDDER_TOKEN", "")
    SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
    SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
    SECRET_NAMES = ["GITHUB_TOKEN", "HF_TOKEN", "QDRANT_URL", "QDRANT_API_KEY",
                    "QDRANT_COLLECTION", "EMBEDDER_TOKEN", "SUPABASE_URL", "SUPABASE_SECRET_KEY"]
    SECRETS = {
        "GITHUB_TOKEN": GITHUB_TOKEN,
        "HF_TOKEN": HF_TOKEN,
        "QDRANT_URL": QDRANT_URL,
        "QDRANT_API_KEY": QDRANT_API_KEY,
        "QDRANT_COLLECTION": QDRANT_COLLECTION,
        "EMBEDDER_TOKEN": EMBEDDER_TOKEN,
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_SECRET_KEY": SUPABASE_SECRET_KEY,
    }
    _rows = "\n".join(f"| `{n}` | {'set' if SECRETS[n] else 'MISSING'} |" for n in SECRET_NAMES)
    _required = ["GITHUB_TOKEN", "HF_TOKEN", "QDRANT_URL", "QDRANT_API_KEY", "EMBEDDER_TOKEN"]
    _missing = [n for n in _required if not SECRETS[n]]
    mo.stop(_missing, mo.md("Missing required molab secrets: " + ", ".join(f"`{n}`" for n in _missing)
                            + ". Add them as molab environment variables, then re-run this cell."))
    _warn = "" if (SUPABASE_URL and SUPABASE_SECRET_KEY) else (
        "\n\n**Warning**: `SUPABASE_URL` / `SUPABASE_SECRET_KEY` are missing; "
        "indexing and the smoke test will stop early.")
    mo.vstack([
        mo.md("| secret | status |\n| --- | --- |\n" + _rows),
        mo.md(f"Work dir `{WORK}`, branch `{BRANCH}`, port {PORT}, collection "
              f"`{QDRANT_COLLECTION}`.{_warn}"),
    ])
    return (BIN, BRANCH, EMBEDDER_TOKEN, GITHUB_TOKEN, HF_HOME, HF_TOKEN, LOGS, PORT,
            QDRANT_COLLECTION, REPO, RUN_INDEX, SHOPS_TO_INDEX, SMOKE_SHOP, SUPABASE_SECRET_KEY,
            SUPABASE_URL, VENV, WORK)


@app.cell
def _(BRANCH, GITHUB_TOKEN, REPO, WORK, base64, mo, os, run):
    # Auth only through the git subprocess environment, so the token never lands in
    # .git/config or in the process list.
    _auth = "Basic " + base64.b64encode(f"x-access-token:{GITHUB_TOKEN}".encode()).decode()
    _git_env = {
        **os.environ,
        "GIT_CONFIG_COUNT": "1",
        "GIT_CONFIG_KEY_0": "http.extraheader",
        "GIT_CONFIG_VALUE_0": f"Authorization: {_auth}",
        "GIT_TERMINAL_PROMPT": "0",
    }
    _has_git = (WORK / ".git").exists()
    if _has_git:
        run(["git", "fetch", "origin", BRANCH], env=_git_env, cwd=WORK,
            redact=(_auth, GITHUB_TOKEN))
        run(["git", "checkout", "-f", "-B", BRANCH, f"origin/{BRANCH}"], cwd=WORK)
        run(["git", "reset", "--hard", f"origin/{BRANCH}"], cwd=WORK)
    else:
        if WORK.exists():
            # molab sometimes leaves a plain directory behind; keep it, never delete.
            _backup, _n = WORK.with_name(f"{WORK.name}.orig"), 2
            while _backup.exists():
                _backup, _n = WORK.with_name(f"{WORK.name}.orig{_n}"), _n + 1
            WORK.rename(_backup)
        run(["git", "clone", "--branch", BRANCH, "--single-branch", REPO, str(WORK)],
            env=_git_env, redact=(_auth, GITHUB_TOKEN))
    run(["git", "remote", "set-url", "origin", REPO], cwd=WORK)
    _sha = run(["git", "rev-parse", "--short", "HEAD"], cwd=WORK).strip()
    _subject = run(["git", "log", "-1", "--format=%s"], cwd=WORK).strip()
    REPO_READY = _sha
    mo.md(f"Checked out `{BRANCH}` at `{_sha}`: {_subject}")
    return (REPO_READY,)


@app.cell
def _(HF_HOME, REPO_READY, VENV, WORK, mo, os, run, shutil, sys):
    _py = VENV / "bin" / "python"
    _uv_bin = shutil.which("uv")
    if _uv_bin is None:
        run([sys.executable, "-m", "pip", "install", "--quiet", "uv"])
        _uv_bin = shutil.which("uv")
    _uv = [_uv_bin] if _uv_bin else [sys.executable, "-m", "uv"]
    if not _py.exists():
        VENV.parent.mkdir(parents=True, exist_ok=True)
        run(_uv + ["venv", "--python", "3.12", str(VENV)])
    # --no-sources ignores the CPU torch index in pyproject, so PyPI's CUDA wheel wins.
    # uvicorn is not a package dependency (Modal serves the ASGI app directly).
    run(_uv + ["pip", "install", "--python", str(_py), "--no-sources", "-e", str(WORK / "embedder"),
               "uvicorn"])

    _probe = """
import torch, transformers, sentence_transformers as st
if not torch.cuda.is_available():
    raise SystemExit('CUDA torch not installed: check nvidia-smi (torch 2.15 cu13 needs NVIDIA driver >= 580); '
                     'fallback: reinstall torch from https://download.pytorch.org/whl/cu128')
dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32
print('torch', torch.__version__, '| transformers', transformers.__version__, '| st', st.__version__)
print('gpu', torch.cuda.get_device_name(0), '| bf16', torch.cuda.is_bf16_supported(), '| dtype', dtype)
"""
    _info = run([str(_py), "-c", _probe], env={**os.environ, "HF_HOME": HF_HOME})
    VENV_READY = True
    mo.md("```\n" + _info.strip() + f"\n```\n\nVenv ready; repo checked out at {REPO_READY}.")
    return (VENV_READY,)


@app.cell
def _(HF_HOME, QDRANT_COLLECTION, RUN_INDEX, SHOPS_TO_INDEX, VENV, VENV_READY, WORK, mo, os,
      run):
    assert VENV_READY
    mo.stop(not RUN_INDEX, mo.md("Indexing is off (RUN_INDEX = False)."))
    mo.stop(not SHOPS_TO_INDEX, mo.md("`SHOPS_TO_INDEX` is empty; add slugs in the config cell."))
    _cmd = [str(VENV / "bin" / "shopmate-index")]
    for _slug in SHOPS_TO_INDEX:
        _cmd += ["--shop", _slug]
    _out = run(_cmd, env={**os.environ, "HF_HOME": HF_HOME}, cwd=WORK / "embedder")
    mo.vstack([
        mo.callout(mo.md("`SUPABASE_URL` / `SUPABASE_SECRET_KEY` must be the **shared** Supabase "
                         f"project (not localhost); vectors go into `{QDRANT_COLLECTION}`."), kind="warn"),
        mo.md(f"```\n{_out.strip()}\n```"),
    ])


@app.cell
def _():
    # Popen handles for this kernel; the pid files cover the after-restart case.
    procs = {"api": None, "tunnel": None}
    return (procs,)


@app.cell
def _(HF_HOME, HF_TOKEN, LOGS, PORT, VENV, VENV_READY, WORK, json, log_tail, mo, os, procs,
      stop_pid, subprocess, terminate, time, urllib):
    assert VENV_READY
    _pid_file, _log_path = LOGS / "api.pid", LOGS / "api.log"
    _old = procs.get("api")
    if _old is not None and _old.poll() is None:
        terminate(_old)
    stop_pid(_pid_file, "uvicorn")

    _env = {**os.environ, "HF_HOME": HF_HOME, "HF_TOKEN": HF_TOKEN}
    with open(_log_path, "wb") as _log:
        procs["api"] = subprocess.Popen(
            [str(VENV / "bin" / "uvicorn"), "--factory", "shopmate_embedder.api:app_from_env",
             "--host", "127.0.0.1", "--port", str(PORT)],
            stdout=_log, stderr=subprocess.STDOUT, start_new_session=True,
            cwd=WORK / "embedder", env=_env)
    _pid_file.write_text(str(procs["api"].pid))

    _health = None
    _deadline = time.monotonic() + 600  # first run downloads ~1.5 GB of weights
    while time.monotonic() < _deadline:
        if procs["api"].poll() is not None:
            raise RuntimeError("API exited during startup:\n" + log_tail(_log_path))
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=5) as _resp:
                _health = json.loads(_resp.read().decode())
            break
        except (OSError, ValueError):
            # RemoteDisconnected/ConnectionReset are OSError; never abort the wait early.
            time.sleep(3)
    if _health is None:
        raise RuntimeError("API did not become healthy within 600 s:\n" + log_tail(_log_path))
    API_URL = f"http://127.0.0.1:{PORT}"
    mo.md(f"API healthy on 127.0.0.1:{PORT}\n\n```json\n{json.dumps(_health, indent=2)}\n```")
    return (API_URL,)


@app.cell
def _(API_URL, BIN, LOGS, log_tail, mo, procs, re, stop_pid, subprocess, terminate, time, urllib):
    _bin = BIN / "cloudflared"
    if not _bin.exists():
        _dl_url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
        # Download next to the target and swap at the end, so an interrupted
        # download cannot leave a truncated binary that is then skipped forever.
        _part = _bin.with_suffix(".part")
        with urllib.request.urlopen(_dl_url, timeout=120) as _dl, open(_part, "wb") as _out:
            while _chunk := _dl.read(1 << 20):
                _out.write(_chunk)
        _part.chmod(0o755)
        _part.replace(_bin)
    _old = procs.get("tunnel")
    if _old is not None and _old.poll() is None:
        terminate(_old)
    stop_pid(LOGS / "tunnel.pid", "cloudflared")

    _log_path = LOGS / "tunnel.log"
    with open(_log_path, "wb") as _log:
        procs["tunnel"] = subprocess.Popen(
            [str(_bin), "tunnel", "--no-autoupdate", "--url", API_URL],
            stdout=_log, stderr=subprocess.STDOUT, start_new_session=True)
    (LOGS / "tunnel.pid").write_text(str(procs["tunnel"].pid))

    # cloudflared prints the URL inside an ASCII box on stderr; skip api.trycloudflare.com.
    _pattern = re.compile(r"https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com")
    TUNNEL_URL = None
    _deadline = time.monotonic() + 90
    while TUNNEL_URL is None and time.monotonic() < _deadline:
        if procs["tunnel"].poll() is not None:
            raise RuntimeError("cloudflared exited:\n" + log_tail(_log_path))
        _match = _pattern.search(log_tail(_log_path, lines=200))
        if _match:
            TUNNEL_URL = _match.group(0)
            break
        time.sleep(2)
    if TUNNEL_URL is None:
        raise RuntimeError("no trycloudflare URL after 90 s:\n" + log_tail(_log_path))

    # DNS needs a few seconds to propagate, so errors are expected at first.
    _health = None
    _deadline = time.monotonic() + 60
    while _health is None and time.monotonic() < _deadline:
        try:
            with urllib.request.urlopen(urllib.request.Request(
                    f"{TUNNEL_URL}/health",
                    headers={"User-Agent": "shopmate-molab/1.0"}), timeout=10) as _resp:
                _health = _resp.read().decode()
        except (OSError, ValueError):
            time.sleep(3)
    _health_line = (
        mo.callout(mo.md(
            f"`{TUNNEL_URL}` did not answer `/health` within 60 s; DNS may still be propagating. "
            "The tunnel is still running: re-run the smoke-test cell in a minute."), kind="warn")
        if _health is None else mo.md(f"Tunnel `/health` returned `{_health.strip()}`"))
    mo.vstack([
        mo.callout(mo.md(f"```\nEMBEDDER_URL={TUNNEL_URL}\n```"), kind="success"),
        mo.md("Set `EMBEDDER_URL` and `EMBEDDER_TOKEN` in the web app's environment (.env.local / "
              "Vercel). The URL changes every time the tunnel restarts."),
        _health_line,
    ])
    return (TUNNEL_URL,)


@app.cell
def _(EMBEDDER_TOKEN, SMOKE_SHOP, SUPABASE_SECRET_KEY, SUPABASE_URL, TUNNEL_URL, WORK,
      base64, json, mo, statistics, time, urllib):
    mo.stop(not (SUPABASE_URL and SUPABASE_SECRET_KEY), mo.md(
        "`SUPABASE_URL` / `SUPABASE_SECRET_KEY` are missing; the smoke test needs them to find the shop id."))
    _headers = {"apikey": SUPABASE_SECRET_KEY, "Authorization": f"Bearer {SUPABASE_SECRET_KEY}"}
    with urllib.request.urlopen(urllib.request.Request(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/shops?slug=eq.{SMOKE_SHOP}&select=id", headers=_headers),
            timeout=20) as _resp:
        _shops = json.loads(_resp.read().decode())
    mo.stop(not _shops, mo.md(f"Shop `{SMOKE_SHOP}` is not in Supabase. Seed the catalog, then set "
                              "`SHOPS_TO_INDEX` and `RUN_INDEX = True` to index it."))
    # SearchBody aliases, see shopmate_embedder/api.py; mediaType is required.
    _body = {
        "shopId": _shops[0]["id"],
        "imageBase64": base64.b64encode((WORK / "supabase/seed/demo/images/AO01.jpg").read_bytes()).decode(),
        "mediaType": "image/jpeg",
        "text": None,
        "limit": 5,
    }
    _search = urllib.request.Request(
        f"{TUNNEL_URL}/search", data=json.dumps(_body).encode(), method="POST",
        headers={"Authorization": f"Bearer {EMBEDDER_TOKEN}", "Content-Type": "application/json",
                 "User-Agent": "shopmate-molab/1.0"})
    # DNS for a fresh tunnel can take a while, so retry transport errors (HTTPError
    # is a URLError subclass and is reported immediately below).
    _result = None
    _deadline = time.monotonic() + 60
    while _result is None:
        try:
            with urllib.request.urlopen(_search, timeout=120) as _resp:
                _result = json.loads(_resp.read().decode())
        except urllib.error.HTTPError as _err:
            mo.stop(True, mo.md(
                f"`/search` failed: HTTP {_err.code}\n\n```\n{_err.read().decode(errors='replace')}\n```"))
        except urllib.error.URLError as _err:
            if time.monotonic() >= _deadline:
                mo.stop(True, mo.md(
                    f"`/search` via `{TUNNEL_URL}` failed after 60 s: {_err.reason}"))
            time.sleep(3)

    _hits = _result.get("hits", [])
    _times = []
    for _ in range(5):
        _start = time.perf_counter()
        with urllib.request.urlopen(_search, timeout=120) as _resp:
            _resp.read()
        _times.append((time.perf_counter() - _start) * 1000)
    mo.vstack([
        mo.md(f"**{len(_hits)} hits** for `{SMOKE_SHOP}` (`{_result.get('model')}`, "
              f"dim {_result.get('dim')}):"),
        mo.ui.table([{"productId": _h["productId"], "score": round(_h["score"], 4)} for _h in _hits]),
        mo.md(f"Warm latency over 5 calls (ms): min {min(_times):.0f}, "
              f"median {statistics.median(_times):.0f}, max {max(_times):.0f}"),
    ])


@app.cell
def _(mo):
    refresh_button = mo.ui.run_button(label="Refresh status")
    refresh_button
    return (refresh_button,)


@app.cell
def _(LOGS, TUNNEL_URL, log_tail, mo, procs, refresh_button):
    # marimo does not track mutations of `procs`; depending on them explicitly
    # re-renders this cell on each button press and once the tunnel is up.
    _ = (refresh_button.value, TUNNEL_URL)
    _rows = []
    for _name in ("api", "tunnel"):
        _proc = procs.get(_name)
        if _proc is None:
            _state = "not started in this kernel"
        elif _proc.poll() is None:
            _state = f"running (pid {_proc.pid})"
        else:
            _state = f"exited ({_proc.returncode})"
        _rows.append(f"| {_name} | {_state} |")
    mo.vstack([
        mo.md("| process | state |\n| --- | --- |\n" + "\n".join(_rows)),
        mo.accordion({
            "api.log (last 15 lines)": mo.md(f"```\n{log_tail(LOGS / 'api.log', lines=15)}\n```"),
            "tunnel.log (last 15 lines)": mo.md(f"```\n{log_tail(LOGS / 'tunnel.log', lines=15)}\n```"),
        }),
    ])


@app.cell
def _(mo):
    stop_button = mo.ui.run_button(label="Stop API and tunnel")
    stop_button
    return (stop_button,)


@app.cell
def _(LOGS, mo, procs, stop_button, stop_pid, terminate):
    _message = "Press the button to kill the API and the tunnel."
    if stop_button.value:
        _stopped = []
        for _name in ("api", "tunnel"):
            _proc = procs.get(_name)
            if _proc is not None and _proc.poll() is None:
                terminate(_proc)
            _expect = "uvicorn" if _name == "api" else "cloudflared"
            _pid = stop_pid(LOGS / f"{_name}.pid", _expect)
            if _pid is not None:
                _stopped.append(f"{_name} (pid {_pid})")
        _message = ("Stopped " + (", ".join(_stopped) or "nothing")
                    + ". The tunnel URL is dead until you re-run the tunnel cell.")
    mo.md(_message)


if __name__ == "__main__":
    app.run()
