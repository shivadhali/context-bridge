# Publishing Context Bridge

The source is prepared for a GitHub repository. No repository or npm package is automatically created by this tool.

## Publish the source

1. Create an empty GitHub repository named `context-bridge` in the account or organization you choose. Choose public visibility if you want everyone to use it. Do not initialize a second README or license.
2. From the local `context-bridge` folder, run:

```sh
git init -b main
git add .
git diff --cached --stat
git commit -m "Initial Context Bridge release"
git remote add origin https://github.com/YOUR_ACCOUNT/context-bridge.git
git push -u origin main
```

Replace `YOUR_ACCOUNT` with the actual owner. Review the staged contents before committing; `.gitignore` excludes dependencies, packages, and the live local context. The demo context is intentionally public.

3. Verify the CI matrix passes on GitHub, enable private vulnerability reporting, and add repository description/topics.
4. Tag a release after review:

```sh
git tag v0.1.0
git push origin v0.1.0
```

5. Create a GitHub release from that tag. `npm pack` produces `context-bridge-cli-0.1.0.tgz`, which can be attached as an installable release artifact.

Users can clone the repository and run `npm ci` followed by `npm link`, or install the downloaded tarball:

```sh
npm install --global ./context-bridge-cli-0.1.0.tgz
```

## Optional npm release

Check package-name availability and ownership first; the working name is not reserved. Consider an account-scoped name. Add the real `repository`, `homepage`, and `bugs` metadata to `package.json`, then regenerate the lockfile if the name changes.

Run `npm ci`, `npm run check`, `npm test`, and `npm pack --dry-run`. Inspect the package contents. Publish only after authenticating to your own npm account and confirming the final package name/version. CI intentionally contains no automatic publication step or credentials.

## Suggested release notes

Context Bridge 0.1.0 carries coding work between AI assistants using two Markdown files. It includes a JavaScript/TypeScript symbol graph, documented function purposes, explicit unresolved relationships, bounded neighborhood retrieval, context checkpoints, Git/source freshness checks, and opt-in Codex/Claude Code instructions. Python and dynamic runtime analysis are not yet supported.
