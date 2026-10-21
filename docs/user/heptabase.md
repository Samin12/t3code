# Heptabase

Open **Heptabase** from the right panel's surface menu in a local desktop thread. Create a whiteboard, or search for an existing one and link it. Sign in to the embedded app once, using the same workspace as your Heptabase desktop app.

The link belongs to the thread. Closing the panel keeps it; reopening the panel restores it. **Unlink** removes the association without deleting the board.

Keep the Heptabase desktop app running with its Local CLI Server enabled and its CLI installed. This integration supports CLI 0.6.x. **Context** reads the board's current structure. Messages sent from the desktop composer include that structure and the board ID, so your selected agent can read and edit the board through the CLI. Sent messages keep the attached data under a **Heptabase context** disclosure. If the linked board cannot be read, reopen Heptabase or unlink it before resending.

The embedded web app and desktop CLI have separate sign-ins, but work on the same synced boards. This surface currently runs on the desktop client with its primary local environment. Remote, mobile, and scheduled messages do not automatically attach this local board context.
