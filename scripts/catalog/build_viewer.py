"""Build the self-contained catalog viewer.

Reads `docs/capability-catalog.json`, inlines it into
`scripts/catalog/viewer_template.html` at the `/*__CATALOG__*/` token,
and writes the result. The output is a single self-contained HTML file
with the catalog data embedded — no fetch, no external data, ready to
serve statically.

Usage:
    python3 scripts/catalog/build_viewer.py                       # writes to $SCRATCH default
    python3 scripts/catalog/build_viewer.py --out PATH            # custom output
    python3 scripts/catalog/build_viewer.py --into-jeff           # writes to jeff/static/
"""

from __future__ import annotations

import argparse
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TOKEN = "/*__CATALOG__*/"

DEFAULT_OUT = "/tmp/ziggy-capability-catalog.html"
JEFF_STATIC = os.path.expanduser("~/Code/jeff/jeff/static/ziggy-capability-catalog.html")


def build(catalog_path: str, template_path: str, out_path: str) -> str:
    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    with open(template_path, "r", encoding="utf-8") as f:
        template = f.read()

    if TOKEN not in template:
        raise ValueError(f"template is missing the {TOKEN} injection point")

    payload = json.dumps(catalog, ensure_ascii=False)
    # A literal </ inside the JSON would close the surrounding <script> tag
    # early. Escape it so the browser sees valid JSON but the HTML parser
    # never sees a closing tag.
    payload = payload.replace("</", "<\\/")

    html = template.replace(TOKEN, payload)

    out_dir = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(out_dir, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    return html


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the self-contained catalog viewer.")
    parser.add_argument(
        "--catalog",
        default=os.path.join(REPO, "docs/capability-catalog.json"),
        help="Path to the catalog JSON.",
    )
    parser.add_argument(
        "--template",
        default=os.path.join(REPO, "scripts/catalog/viewer_template.html"),
        help="Path to the viewer template.",
    )
    parser.add_argument(
        "--out",
        default=DEFAULT_OUT,
        help="Output HTML path (default: %(default)s).",
    )
    parser.add_argument(
        "--into-jeff",
        action="store_true",
        help=f"Write to jeff/static ({JEFF_STATIC}) as well as --out.",
    )
    args = parser.parse_args()

    if not os.path.exists(args.catalog):
        print(f"catalog not found: {args.catalog}", file=sys.stderr)
        return 2
    if not os.path.exists(args.template):
        print(f"template not found: {args.template}", file=sys.stderr)
        return 2

    html = build(args.catalog, args.template, args.out)
    print(f"wrote {args.out}  ({len(html):,} bytes)")

    if args.into_jeff:
        os.makedirs(os.path.dirname(JEFF_STATIC), exist_ok=True)
        with open(JEFF_STATIC, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"wrote {JEFF_STATIC}  ({len(html):,} bytes)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
