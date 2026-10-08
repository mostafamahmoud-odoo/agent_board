# Integration test workspace

`.vscode-test.mjs` opens this directory as the workspace folder for the
integration suite. The tests then write boards into `.agent/` here and assert
on what the extension does with them.

**This file exists so the directory does.** Git does not track empty
directories, and everything the tests create inside this folder (`.agent/`) is
gitignored — so without a tracked file here the directory simply does not exist
in a fresh clone. VS Code is then asked to open a path that is not there,
`vscode.workspace.workspaceFolders` comes back `undefined`, and every test that
resolves a path under it fails with

    TypeError: Cannot read properties of undefined (reading '0')

That was 12 of 23 tests failing on CI while the whole suite passed locally,
because locally the directory had been created by an earlier run.

Do not delete this file.
