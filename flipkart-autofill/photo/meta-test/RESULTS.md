# Metadata probe — does Meesho read image metadata?

Source: photo/1.png  ·  1254x1254  ·  generated 2026-07-26

All five files are PIXEL-IDENTICAL. Metadata is the only difference.
Upload each as the main image, note the shipping fee, fill in the table.

| File | What differs | Shipping fee |
|---|---|---|
| M0.jpg | stripped — no metadata at all | |
| M1.jpg | current pipeline EXIF | |
| M2.jpg | 300 DPI print density | |
| M3.jpg | camera scale hints (SubjectDistance 0.6m, FocalLength 50mm) | |
| M4.jpg | truthful pack facts in the description | |

## Reading it

- **All five identical** → metadata is not read. Question closed for good; delete this folder.
- **M0 differs from M1** → metadata is read at all. Big finding.
- **M2 differs** → a naive pixels/DPI physical-size estimate is in play.
- **M3 differs** → camera scale hints feed the estimate.
- **M4 differs** → the description TEXT is parsed. Best case: truthful pack facts lower it.

Anything that only moves by a rupee or two is noise — re-upload the same file twice to see
how much the number wobbles on its own before believing a small difference.
