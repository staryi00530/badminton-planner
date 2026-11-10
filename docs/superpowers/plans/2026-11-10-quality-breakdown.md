# Per-game admin point breakdown

User requested the point breakdown alongside the newly displayed quality points. Small display extension: expandable native details below each admin score, lazy table while open to preserve collapsed-view performance. Reuse the exact existing live/projected assessment, without recomputation or scoring changes. Display format, five contributing factors with raw value × weight and signed points, total, assumed level defaults and separate waiting explanation. Keep assessments private to admin UI. Explain played versus projected history.

Validation: component regression checks signed factor points and total; board integration checks admin-only propagation; browser handoff scenario opens and closes a real card breakdown. Run full checks/build, review, push beta only and verify Pages.
