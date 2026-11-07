# @gulz/agent

The GULZ agent runtime coordinates a provider model, registered tools, execution policy and verified tool results.

- Models propose tool calls; they never grant their own permissions.
- Tool implementations own argument validation and risk classification.
- Moderate and higher-risk tools require an approval callback; absent approval means deny.
- Runs are bounded by round and tool-call limits and support AbortSignal cancellation.
- The initial local catalogue is restricted to workspace inspection, directory listing, bounded text reads, approved file writes/directories and a fixed diagnostic command allowlist.
- Remote execution is represented by an injected transport contract. This package does not claim to ship an SSH daemon or remote VPS execution yet.
