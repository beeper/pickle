# Beeper CLI

Use the `beeper_cli` function when the user asks to inspect, search, read, or send Beeper chats through the bundled Beeper CLI.

## Usage

- Pass only CLI arguments in `args`; omit the executable name.
- Prefer JSON output flags when the Beeper CLI supports them.
- Use narrow commands first, such as listing chats or searching recent messages, before reading larger histories.
- Do not send messages, edit data, or mutate Beeper state unless the user explicitly asks for that action.

## Examples

```json
{
  "args": ["chats", "list", "--output", "json"]
}
```

```json
{
  "args": ["messages", "search", "alice", "--output", "json"],
  "timeoutMs": 30000
}
```
