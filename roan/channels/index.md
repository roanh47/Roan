# roan/channels/

One file per channel. Every channel is a front-end over the same `Agent`, so
adding one means implementing `BaseChannel` and nothing else.

* [Telegram](telegram.md) - polling, per-chat sessions, message splitting and the escape rules.
