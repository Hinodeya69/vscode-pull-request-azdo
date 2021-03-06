# Changelog

## 0.0.8
### Changes

- Fixed [ankitbko/vscode-pull-request-azdo#8](https://github.com/ankitbko/vscode-pull-request-azdo/issues/8)
- Tests now work

## 0.0.7
### Changes

- Fixed overflow in batches calculation while getting files in PR

## 0.0.6
### Changes

- Disabled resolveRemote to fix [ankitbko/vscode-pull-request-azdo#5](https://github.com/ankitbko/vscode-pull-request-azdo/issues/5)
- Added key check on secretStore onDidChange.

## 0.0.5
### Changes

- Specified allowCrossOriginAuthentication as true as attempt to fix fix [ankitbko/vscode-pull-request-azdo#4](https://github.com/ankitbko/vscode-pull-request-azdo/issues/4)

## 0.0.4
### Changes

- Added ssh.dev.azure.com to list of valid hosts - Fixes [ankitbko/vscode-pull-request-azdo#3](https://github.com/ankitbko/vscode-pull-request-azdo/issues/3)

## 0.0.3
### Changes

- Changed URI Scheme
- Backported #2538 from upstream

## 0.0.2

### Changes

- Changed command names and view names to make it globally unique.

## 0.0.1

### Changes

First release with following features -

- Authenticating and connecting VS Code to Azure Devops.
- Listing and browsing PRs from within VS Code.
- Reviewing PRs from within VS Code with in-editor commenting.
- Validating PRs from within VS Code with easy checkouts.
