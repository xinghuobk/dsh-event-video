# Contributing

Thanks for improving DSH Event Video. This repository currently contains four pieces: the Python engine (`engine/`), the DSH tool plugin (`plugin/`), the DSH Web bundle (`bundle/`), and the reflex camera worker (`camera/`).

## Development setup

```bash
# engine
python -m venv .venv
. .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -e "engine[dev]"
pytest -q engine/tests

# node syntax checks (no build step needed)
node --check plugin/lib/index.js
node --check bundle/index.js
node --check bundle/client.js
```

## Rules of thumb

- The plugin (`plugin/`) must stay dependency-free: Node builtins only. The DSH loader resolves bare specifiers from the application install, not the profile, so third-party imports break loading.
- The bundle host half must not hardcode machine paths. Use `configure(config)` / environment variables; defaults live under the data home.
- Every new deterministic review rule belongs in `engine/event_build/pipeline.py::review_of` with a test in `engine/tests/test_pipeline.py`.
- Keep the engine output deterministic: no set-order-dependent choices (see `dominant_url`).
- Camera capture is opt-in and local-only. Do not add background capture or uploads.

## Pull requests

- Describe the user-visible change and the verification you ran.
- Include a test for behavior changes (engine: pytest; UI: manual steps in the PR description).
- Keep unrelated refactors out of feature PRs.
