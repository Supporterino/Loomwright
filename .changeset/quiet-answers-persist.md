---
"@loomwright/core": patch
"@loomwright/cli": patch
---

Answers recorded in the TUI now persist even when no driver owns the run: the answer is applied
under the run lock, one `question.answered` event is emitted, `.factory/clarifications/<id>.md`
and the change's `questions.md` are refreshed, and a re-delivered answer is a no-op. A live
driver keeps consuming the inbox and now refreshes `questions.md` as well.
