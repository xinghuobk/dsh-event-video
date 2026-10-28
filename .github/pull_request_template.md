name: Pull request
description: Describe the change and how it was verified
body:
  - type: markdown
    attributes:
      value: Keep unrelated refactors out of feature PRs.
  - type: textarea
    id: change
    attributes:
      label: What changed
      description: User-visible behavior first, then implementation notes.
    validations:
      required: true
  - type: textarea
    id: verify
    attributes:
      label: Verification
      description: Commands run and what you checked manually.
      placeholder: |
        pytest -q engine/tests
        node --check plugin/lib/index.js bundle/index.js bundle/client.js
        Ran the 50s demo and reviewed event.json + analysis.md
    validations:
      required: true
  - type: checkboxes
    id: conventions
    attributes:
      label: Conventions
      options:
        - label: Plugin stays dependency-free (Node builtins only)
        - label: New deterministic review rule has a test
        - label: Camera remains opt-in and local-only
        - label: Docs updated with the behavior change
