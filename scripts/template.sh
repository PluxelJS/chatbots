#!/usr/bin/env sh
set -eu

cmd="${1:-}"
shift || true

if [ ! -d "../pluxel-template/.git" ] && [ ! -f "../pluxel-template/.git" ]; then
	echo "[template] missing ../pluxel-template (requires pluxel-workspace layout)" >&2
	exit 2
fi

case "$cmd" in
	status)
		git -C ../pluxel-template status -sb
		;;
	pull)
		git -C ../pluxel-template pull --ff-only
		;;
	update)
		git -C ../pluxel-template pull --ff-only
		;;
	*)
		echo "Usage: scripts/template.sh <status|pull|update>" >&2
		exit 2
		;;
esac
